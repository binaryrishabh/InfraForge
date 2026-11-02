import { compileProduct, contractFromDesign, createProductModel2 } from "../src/internalProduct";
import { withRunLength } from "../src/model2/product/runContract";
import type { CausalEvent } from "../src/model2/workload/causal";
import { quantities } from "./workloadFixture";
import { latencyDesign } from "./latency.fixture";

export function timeoutFixture(options: { timeout?: number; attempts?: number; backoff?: number; policy?: "detach" | "request-cancellation"; unsupported?: boolean; write?: boolean; rootTimeout?: number; queue?: number; rate?: number; stopAt?: number } = {}) {
  const design = latencyDesign(true);
  design.resources = design.resources.filter(r => r.id === "app"); design.connections = [];
  design.resources[0]!.vmExecution = { version: 1, workers: 1, queuedRequests: options.queue ?? 10 };
  design.workload.targetThroughput = options.rate ?? 60;
  design.workload.readWriteRatio = options.write ? 0 : 1;
  design.workload.clientRetry = { version: 1, maxAttempts: options.attempts ?? 2, backoffMs: options.backoff ?? 1, attemptTimeoutMs: options.timeout ?? 1 };
  const b = contractFromDesign(design); if ("refused" in b) throw Error(JSON.stringify(b));
  const contract = withRunLength(b.contract, 1, "attempt-timeout-engine");
  const { q, ledger } = quantities();
  contract.arrival.changes = [{ at: q("load.stop", options.stopAt ?? 1, "us"), fraction: q("load.zero", 0, "ratio") }];
  for (const op of contract.application!.operations) {
    op.onCallerStop = options.policy ?? "request-cancellation";
    if (options.rootTimeout) op.callerTimeout = q(`root.${op.id}`, options.rootTimeout, "us");
  }
  contract.ledger.push(...ledger);
  const c = compileProduct(design, contract); if (!c.ok) throw Error(JSON.stringify(c));
  if (options.unsupported) for (const r of c.value.input.resources) if (r.kind === "compute") r.cancellation = "unsupported";
  const events: CausalEvent[] = [];
  const runtime = createProductModel2(c.value, undefined, e => events.push(e));
  return { runtime, events, compiled: c.value };
}
