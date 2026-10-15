import { writeFileSync } from "node:fs";
import { asyncFixture } from "../../packages/simulation/tests/asyncFixture";
import { createAsyncModel2 } from "../../packages/simulation/src/model2/async/run";
import { quantities } from "../../packages/simulation/tests/workloadFixture";
import type { BrokerConfig, ObjectConfig, WorkerConfig } from "../../packages/simulation/src/model2/async/contracts";
const cases = [];
for (const scenario of ["backlog", "consumers", "lease-expiry", "large-inventory", "large-values"]) {
  const i = asyncFixture({ count: 1000, interval: 10, horizon: 2000000, workers: scenario === "consumers" ? 16 : 4, prefetch: 16, concurrency: 4, lease: scenario === "lease-expiry" ? 500 : 100000, ackDelay: scenario === "lease-expiry" ? 1000 : 0, processing: 50, objectBytes: scenario === "large-values" ? 104857600 : 256, bandwidth: 100000000000, timeout: 1000000, raw: 20 }), q = quantities("Owner-local M2F executor measurement; synthetic resource values, no external capacity claim");
  const b = i.resources.find((r) => r.kind === "delivery-queue") as BrokerConfig, s = i.resources.find((r) => r.kind === "object-store") as ObjectConfig;
  i.sampleInterval = q.q("perf.sampleInterval", 500000, "us");
  for (const worker of i.resources.filter((r) => r.kind === "async-worker") as WorkerConfig[]) worker.pollInterval = q.q(`perf.${worker.id}.poll`, 1000, "us");
  if (scenario === "backlog") for (let worker = 0; worker < 4; worker++) i.asyncInterventions.push({ id: `consumer-pause-${worker}`, kind: "consumer-state", target: `worker-${worker}`, available: false, at: q.q(`perf.pause.${worker}.at`, 0, "us"), duration: q.q(`perf.pause.${worker}.duration`, 300000, "us") });
  if (scenario === "large-inventory") { const bytes = q.q("perf.inventory.bytes", 1, "bytes"); s.initial = Array.from({ length: 98000 }, (_, j) => ({ namespace: "inventory", key: `blob-${j}`, generation: j + 1, bytes, content: "logical-blob" })); }
  if (scenario === "large-values") { s.capacity = q.q("perf.logicalCapacity", 200000000000, "bytes"); const buffer = q.q("perf.largeBodyBuffer", 100000000000, "bytes"); for (const link of i.links) link.bufferBytes = buffer; }
  b.capacityMessages = q.q("perf.messages", 10000, "count"); b.capacityBytes = q.q("perf.messageBytes", 10000000, "bytes"); i.ledger.push(...q.ledger);
  const start = performance.now(), m = createAsyncModel2(i), setupMs = performance.now() - start;
  const run = performance.now(); m.advanceTo(m.horizon); const executionMs = performance.now() - run;
  const observe = performance.now(), e = m.evidence(), evidenceMs = performance.now() - observe;
  const encode = performance.now(), json = JSON.stringify(e), serializeMs = performance.now() - encode;
  const broker = e.asynchronous.brokers[0]!, store = e.asynchronous.objects[0]!;
  if (broker.accepted !== broker.ready + broker.inFlight + broker.scheduled + broker.acknowledged + broker.deadLettered + broker.discarded + broker.expired || store.objects.reduce((n, o) => n + o.bytes, 0) !== store.storedBytes) throw Error("Async performance conservation");
  cases.push({ scenario, setupMs, executionMs, evidenceMs, serializeMs, evidenceBytes: Buffer.byteLength(json), heapUsed: process.memoryUsage().heapUsed, execution: e.execution, counts: e.counts, broker: { accepted: broker.accepted, deliveries: broker.deliveries, redelivered: broker.redelivered, deadLettered: broker.deadLettered, ready: broker.ready, inFlight: broker.inFlight, acknowledged: broker.acknowledged }, objects: { count: store.objects.length, logicalBytes: store.storedBytes, puts: store.committedPuts, gets: store.gets }, workers: e.asynchronous.workers.map((w) => ({ id: w.id, processed: w.processed, active: w.active, local: w.creditOwnedLocally })), ledger: q.ledger });
}
const report = { scope: "Owner-local Bun executor only, variable GC/interference; large logical values have size metadata without giant payload buffers", cases };
writeFileSync(new URL("../../docs/reality/m2f-performance.json", import.meta.url), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(cases.map(({ scenario, setupMs, executionMs, evidenceMs, serializeMs, broker, objects }) => ({ scenario, setupMs, executionMs, evidenceMs, serializeMs, broker, objects }))));
