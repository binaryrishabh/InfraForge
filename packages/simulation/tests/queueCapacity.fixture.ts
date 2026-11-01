import { design, prepare } from "./asyncCanvas.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline, type TimedAction } from "../src/model2/product/timeline";
import { createProductModel2 } from "../src/model2/product/run";

export const capacityModes = ["normal", "poison", "outage", "visibility", "parallel"] as const;
export function capacityDesign(mode: typeof capacityModes[number] = "normal", capacityMessages?: number) {
  const saved = design(true, 8), queue = saved.resources.find(r => r.id === "queue")!, worker = saved.resources.find(r => r.id === "worker")!;
  if (capacityMessages !== undefined) Object.assign(queue.asyncQueue!, { capacityMessages });
  if (mode === "poison") { worker.asyncWorker!.badJobPercent = 100; queue.asyncQueue!.deadLetterCapacity = 2; }
  if (mode === "visibility") { queue.asyncQueue!.visibilityTimeoutSeconds = 1; worker.asyncWorker!.cpuMsPerJob = 1500; }
  if (mode === "parallel") { worker.size = "medium"; worker.asyncWorker!.concurrency = 2; worker.asyncWorker!.prefetch = 4; }
  return saved;
}
export function capacitySetup(mode: typeof capacityModes[number] = "normal", capacityMessages?: number) {
  const saved = capacityDesign(mode, capacityMessages), adapted = prepare(saved);
  const actions: TimedAction[] = [{ id: "stop", kind: "load", atUs: 10_000_001, fraction: 0 }];
  if (mode === "outage") actions.push({ id: "outage", kind: "intervention", atUs: 1_000_001, request: { interventionId: "consumer-outage", revision: 1, target: { resourceId: "worker" }, parameters: { duration: 5 } } });
  const contract = withTimeline(withRunLength(adapted.contract, 70, "queue-capacity-proof"), actions);
  const result = compileProduct(saved, contract); if (!result.ok) throw Error(JSON.stringify(result));
  return { saved, contract, assumptions: adapted.assumptions, compiled: result.value, runtime: createProductModel2(result.value) };
}
