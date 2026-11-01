import { capacityDesign, type capacityModes } from "./queueCapacity.fixture";
import { prepare } from "./asyncCanvas.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline, type TimedAction } from "../src/model2/product/timeline";
import { createProductModel2 } from "../src/model2/product/run";

export function idempotencySetup(enabled?: boolean, mode: typeof capacityModes[number] = "visibility", capacity?: number, single = true, maxReceives = 3, lease?: number) {
  const saved = capacityDesign(mode, capacity), worker = saved.resources.find(r => r.id === "worker")!, queue = saved.resources.find(r => r.id === "queue")!;
  if (enabled !== undefined) worker.asyncWorker!.idempotentResults = enabled;
  queue.asyncQueue!.maxReceives = maxReceives;
  if (lease !== undefined) queue.asyncQueue!.visibilityTimeoutSeconds = lease;
  const adapted = prepare(saved);
  const actions: TimedAction[] = [{ id: "stop", kind: "load", atUs: single ? 1 : 10_000_001, fraction: 0 }];
  if (mode === "outage") actions.push({ id: "outage", kind: "intervention", atUs: 1_000_001, request: { interventionId: "consumer-outage", revision: 1, target: { resourceId: "worker" }, parameters: { duration: 5 } } });
  const contract = withTimeline(withRunLength(adapted.contract, 70, "queue-idempotency-proof"), actions);
  const result = compileProduct(saved, contract); if (!result.ok) throw Error(JSON.stringify(result));
  return { saved, contract, compiled: result.value, runtime: createProductModel2(result.value) };
}
