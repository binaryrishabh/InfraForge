import { capacityDesign } from "./queueCapacity.fixture";
import { prepare } from "./asyncCanvas.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline, type TimedAction } from "../src/model2/product/timeline";
import { createProductModel2 } from "../src/model2/product/run";

export function depthSetup(acknowledgementDelayMs?: number, visibilitySeconds = 1, crash = false) {
  const saved = capacityDesign("normal", 3);
  saved.resources.find(r => r.id === "queue")!.asyncQueue!.visibilityTimeoutSeconds = visibilitySeconds;
  if (acknowledgementDelayMs !== undefined) Object.assign(saved.resources.find(r => r.id === "worker")!.asyncWorker!, { acknowledgementDelayMs });
  const adapted = prepare(saved);
  const actions: TimedAction[] = [{ id: "stop", kind: "load", atUs: 1, fraction: 0 }];
  if (crash) actions.push({ id: "crash", kind: "intervention", atUs: 500_000, request: { interventionId: "consumer-outage", revision: 1, target: { resourceId: "worker" }, parameters: { duration: 2 } } });
  const contract = withTimeline(withRunLength(adapted.contract, 15, "queue-depth-proof"), actions);
  const compiled = compileProduct(saved, contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  return { saved, contract, compiled: compiled.value, runtime: createProductModel2(compiled.value) };
}
