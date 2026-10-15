import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { createWorkloadModel2 } from "../../packages/simulation/src/model2/workload/run";
import { ingestTrace } from "../../packages/simulation/src/model2/workload/arrivals";
import { workloadFixture } from "../../packages/simulation/tests/workloadFixture";

const count = 100000;
const traceStart = performance.now();
function* rows() { for (let i = 0; i < count; i++) yield { id: String(i), atUs: i * 2, operation: "light" }; }
const trace = ingestTrace({ schema: "infraforge-arrivals/1", unit: "us", durationUs: count * 2, provenance: "Synthetic scalability probe" }, rows(), count, new Set(["light"]));
const traceGenerationMs = performance.now() - traceStart;
const measurements = [];
for (const kind of ["lazy-periodic", "bounded-trace"] as const) {
  const input = workloadFixture({ count, cpu: 1, interval: 2, horizon: count * 2 + 10, timeout: 1000000000, sample: 5000, raw: 100 });
  if (kind === "bounded-trace") input.arrivals = [{ id: "load", kind: "trace", trace }];
  const memoryBefore = process.memoryUsage().heapUsed, setupStart = performance.now(), model = createWorkloadModel2(input), setupMs = performance.now() - setupStart;
  const start = performance.now(); model.advanceTo(model.horizon); const eventExecutionMs = performance.now() - start;
  const aggregate = performance.now(), evidence = model.evidence(), aggregationMs = performance.now() - aggregate;
  const serialize = performance.now(), json = JSON.stringify(evidence), serializationMs = performance.now() - serialize;
  if (evidence.counts.completed !== count || evidence.results.length !== 100 || evidence.resultRetention.omitted !== count - 100 || evidence.execution.peakPending > 10 || evidence.execution.pending !== 0) throw new Error("Scalability/accounting regression");
  measurements.push({ kind, count, setupMs, eventExecutionMs, aggregationMs, serializationMs, serializedBytes: Buffer.byteLength(json), execution: evidence.execution, retained: evidence.resultRetention,
    heapUsedBefore: memoryBefore, heapUsedAfter: process.memoryUsage().heapUsed });
}
const report = { scope: "One local Windows Bun run; warm-up/GC/CPU interference uncontrolled; timings are not guarantees", runtime: Bun.version, hostCpu: cpus()[0]!.model, traceGenerationMs, measurements,
  baseline: { scope: "M2A kernel before indexed cancellation; 100000 retained no-op deadlines", schedulingMs: 61.3781, expiryMs: 162.92, events: 100000, peakPending: 100000 } };
writeFileSync(new URL("../../docs/reality/m2b-performance.json", import.meta.url), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
