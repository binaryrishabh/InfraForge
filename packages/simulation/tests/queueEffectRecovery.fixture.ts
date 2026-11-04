import { design, prepare } from "./asyncCanvas.fixture";
import { quantities } from "./workloadFixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline, type TimedAction } from "../src/model2/product/timeline";

export function effectRecovery(idempotent: boolean, outage = true, poison = false, deadLetters = 1) {
  const saved = design(true, poison ? 8 : 1), worker = saved.resources.find(r => r.id === "worker")!, queue = saved.resources.find(r => r.id === "queue")!;
  Object.assign(worker.asyncWorker!, { cpuMsPerJob: 100, prefetch: poison ? 4 : 1, idempotentResults: idempotent, ...(poison ? { badJobPercent: 100 } : {}) });
  Object.assign(queue.asyncQueue!, { visibilityTimeoutSeconds: 2, capacityMessages: poison ? 4 : 1, deadLetterCapacity: deadLetters });
  const adapted = prepare(saved), q = quantities("Authored delayed delivery and post-effect/pre-ack failure window; no physical timing claim");
  const publisher = adapted.contract.nodes.app!.resources.find(r => r.config.kind === "async-publisher")!.config;
  const consumer = adapted.contract.nodes.worker!.resources.find(r => r.config.kind === "async-worker")!.config;
  if (publisher.kind !== "async-publisher" || consumer.kind !== "async-worker") throw Error("Expected async owners");
  publisher.delay = q.q("window.deliveryDelay", 1000000, "us");
  consumer.ackDelay = q.q("window.ackDelay", 500000, "us");
  adapted.contract.ledger.push(...q.ledger);
  const actions: TimedAction[] = [{ id: "stop", kind: "load", atUs: poison ? 1000001 : 1, fraction: 0 }];
  if (outage) actions.push({ id: "post-effect-loss", kind: "intervention", atUs: 1500000, request: { interventionId: "consumer-outage", revision: 1, target: { resourceId: "worker" }, parameters: { duration: 2 } } });
  const contract = withTimeline(withRunLength(adapted.contract, 8, "queue-effect-window"), actions);
  const compiled = compileProduct(saved, contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return { saved, contract, compiled: compiled.value, runtime: createProductModel2(compiled.value) };
}
