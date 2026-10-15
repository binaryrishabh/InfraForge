import { writeFileSync } from "node:fs";
import { computeFixture } from "../../packages/simulation/tests/computeFixture";
import { quantities } from "../../packages/simulation/tests/workloadFixture";
import { createComputeModel2 } from "../../packages/simulation/src/model2/compute/run";
import type { ComputeResource } from "../../packages/simulation/src/model2/compute/contracts";
const cases = [];
for (const workers of [1, 8, 64, 256]) {
  const input = computeFixture({ count: 10000, cpu: 100, cores: 4, slots: workers, interval: 1, wait: 10, horizon: 3000000, timeout: 1000000000, queue: 10000, sample: 1000000, raw: 100 }), q = quantities();
  if (workers === 64) {
    (input.resources[0] as ComputeResource).quota = { budget: q.q("perf.quota.budget", 1000, "cpu-us"), period: q.q("perf.quota.period", 1000, "us") };
    input.faults = [{ id: "pause", target: "app", kind: "pause-service", at: q.q("perf.pause.at", 10000, "us"), duration: q.q("perf.pause.duration", 10000, "us") }];
    input.interventions = [{ id: "competitor", target: "app", kind: "competitor", at: q.q("perf.comp.at", 1000, "us"), duration: q.q("perf.comp.duration", 100000, "us"), demand: q.q("perf.comp.cpu", 100000, "cpu-us"), parallelism: q.q("perf.comp.cap", 4, "cores") }];
  }
  input.ledger.push(...q.ledger); const start = performance.now(), m = createComputeModel2(input), setupMs = performance.now() - start;
  const execute = performance.now(); m.advanceTo(m.horizon); const executionMs = performance.now() - execute;
  const aggregate = performance.now(), e = m.evidence(), aggregationMs = performance.now() - aggregate;
  const serialize = performance.now(), json = JSON.stringify(e), serializationMs = performance.now() - serialize;
  if (e.counts.completed !== 10000 || e.resources[0]!.compute!.memory.ownership.requests !== 0) throw new Error("Compute performance case did not reconcile/drain");
  cases.push({ workers, setupMs, executionMs, aggregationMs, serializationMs, serializedBytes: Buffer.byteLength(json), events: e.execution, boundaryEvents: (e.resources[0]!.compute!.cpu as { boundaries?: number }).boundaries, retained: e.resultRetention, heapUsed: process.memoryUsage().heapUsed });
}
const report = { scope: "Local Bun timing only; GC, frequency and interference uncontrolled; no hardware guarantee", cases };
writeFileSync(new URL("../../docs/reality/m2c-performance.json", import.meta.url), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
