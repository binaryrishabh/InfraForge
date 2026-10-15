import { writeFileSync } from "node:fs";
import { dataFixture } from "../../packages/simulation/tests/dataFixture";
import { quantities } from "../../packages/simulation/tests/workloadFixture";
import { createDataModel2 } from "../../packages/simulation/src/model2/data/run";
import type { RelationalConfig, CacheConfig, AsideConfig } from "../../packages/simulation/src/model2/data/contracts";
const cases = [];
for (const scenario of ["queries", "large-keyset", "expirations", "stampede", "locks"]) {
  const input = dataFixture({ keys: 32, count: 2000, interval: scenario === "stampede" ? 1 : 20, cpu: scenario === "stampede" ? 1 : 50, horizon: 10000000, timeout: 100000000, responseTimeout: 100000000, acquireTimeout: 100000000, sample: 1000000, raw: 20, slots: 128, connections: 64, sessions: 64, activeTransactions: 64, dbCpu: scenario === "stampede" ? 1000 : 50, ttl: scenario === "expirations" ? 200 : 100000000 }), q = quantities("Local M2E executor performance experiment; synthetic workloads, not system capacity");
  const d = input.resources.find((r) => r.kind === "relational") as RelationalConfig, c = input.resources.find((r) => r.kind === "cache") as CacheConfig, a = input.resources.find((r) => r.kind === "cache-aside") as AsideConfig;
  if (scenario === "large-keyset") { d.keys = Array.from({ length: 100000 }, (_, i) => `k${i}`); d.initial = d.keys.map((key) => ({ key, version: 1, bytes: d.initial[0]!.bytes })); a.keys = d.keys; c.capacity = q.q("perf.capacity", 8000000, "bytes"); c.initial = d.initial; }
  if (scenario === "stampede" || scenario === "locks") a.keys = ["k0"];
  if (scenario === "stampede") for (const [id, p] of Object.entries(d.plans)) { p.statementTimeout = q.q(`perf.${id}.statement`, 1000000, "us"); p.transactionTimeout = q.q(`perf.${id}.transaction`, 1000000, "us"); }
  if (scenario === "locks") { const arrival = input.arrivals[0]!; if (arrival.kind !== "trace") arrival.operation = "heavy"; d.plans.heavy!.durability = "authored-log-ack"; d.plans.heavy!.commitWait = q.q("perf.ack", 100, "us"); }
  input.ledger.push(...q.ledger); const start = performance.now(), m = createDataModel2(input), setupMs = performance.now() - start;
  const run = performance.now(); m.advanceTo(m.horizon); const executionMs = performance.now() - run;
  const aggregate = performance.now(), e = m.evidence(), aggregationMs = performance.now() - aggregate;
  const serialize = performance.now(), output = JSON.stringify(e), serializationMs = performance.now() - serialize;
  if (e.counts.inFlight || e.counts.offered !== e.counts.completed + e.counts.rejected + e.counts.deadlineExceeded + e.counts.abandoned) throw Error("Performance population did not drain");
  cases.push({ scenario, keys: d.keys.length, roots: 2000, setupMs, executionMs, aggregationMs, serializationMs, serializedBytes: Buffer.byteLength(output), heapUsed: process.memoryUsage().heapUsed, execution: e.execution, counts: e.counts, database: { transactions: e.data.databases[0]!.transactions, locks: e.data.databases[0]!.locks, sessions: e.data.databases[0]!.sessions }, cache: { lookups: e.data.caches[0]!.lookups, fills: e.data.caches[0]!.fills, expirations: e.data.caches[0]!.expirations, entries: e.data.caches[0]!.entries.length }, application: { live: e.data.applications[0]!.live, omitted: e.data.applications[0]!.omitted }, ledger: q.ledger });
}
const report = { scope: "Owner-local Bun executor, variable GC/interference; timings are not PG/Redis/provider performance. Cache expiry uses no recurring per-key timer.", cases };
writeFileSync(new URL("../../docs/reality/m2e-performance.json", import.meta.url), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(cases.map(({ scenario, setupMs, executionMs, aggregationMs, serializationMs }) => ({ scenario, setupMs, executionMs, aggregationMs, serializationMs }))));
