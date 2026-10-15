import { readFileSync, writeFileSync } from "node:fs";
import { dataFixture } from "../../packages/simulation/tests/dataFixture";
import { quantities } from "../../packages/simulation/tests/workloadFixture";
import { createDataModel2 } from "../../packages/simulation/src/model2/data/run";
import { relationalDatabase } from "../../packages/simulation/src/model2/data/database";
import { EventKernel } from "../../packages/simulation/src/model2/time";
import type { DataInput, RelationalConfig, CacheConfig } from "../../packages/simulation/src/model2/data/contracts";
const database = (i: DataInput) => i.resources.find((r) => r.kind === "relational") as RelationalConfig;
const cache = (i: DataInput) => i.resources.find((r) => r.kind === "cache") as CacheConfig;
function run(i: DataInput) {
  const m = createDataModel2(i); m.advanceTo(m.horizon); const e = m.evidence();
  return { counts: e.counts, data: e.data, resources: e.resources, paths: e.network.paths, results: e.results, ledger: i.ledger, policy: "Synthetic mechanism proof only; all inputs forbidden from Free Mode. Health probes are real additional internal operations." };
}
export function dataProofs() {
  const normal = run(dataFixture({ keys: 1, count: 24, interval: 1000, ttl: 100000 }));
  const outage = dataFixture({ keys: 1, count: 24, interval: 1000, ttl: 100000 }), q = quantities("M2E synthetic cascade/lock/session proof; not calibrated performance");
  outage.networkInterventions.push({ id: "cache-outage", kind: "service-state", target: "cache", alive: false, ready: false, at: q.q("outage.at", 5000, "us"), duration: q.q("outage.duration", 6000, "us") });
  outage.paths.find((p) => p.target === "cache")!.pool.connectTimeout = q.q("outage.connect", 500, "us"); outage.paths.find((p) => p.target === "cache")!.pool.responseTimeout = q.q("outage.response", 500, "us");
  outage.dataInterventions.push({ id: "cache-flush", kind: "flush", target: "cache", at: q.q("flush.at", 5000, "us") }); outage.ledger.push(...q.ledger); const cacheFailure = run(outage);
  const dbOut = dataFixture({ keys: 2, count: 24, interval: 700, ttl: 100000 }), dq = quantities(); cache(dbOut).initial = [structuredClone(database(dbOut).initial[0]!)];
  dbOut.networkInterventions.push({ id: "db-outage", kind: "service-state", target: "db", alive: false, ready: false, at: dq.q("db.at", 0, "us"), duration: dq.q("db.duration", 7000, "us") });
  const dp = dbOut.paths.find((p) => p.target === "db")!; dp.pool.connectTimeout = dq.q("db.connect", 500, "us"); dp.pool.responseTimeout = dq.q("db.response", 500, "us"); dbOut.ledger.push(...dq.ledger);
  const stampede = run(dataFixture({ keys: 1, count: 40, interval: 1, slots: 64, dbCpu: 1000, ttl: 100000 })), coalesced = run(dataFixture({ keys: 1, count: 40, interval: 1, slots: 64, dbCpu: 1000, ttl: 100000, coalesce: true }));
  const capacity = run(dataFixture({ keys: 8, count: 32, interval: 500, capacity: 160, ttl: 100000 })), ttl = run(dataFixture({ keys: 1, count: 16, interval: 1000, ttl: 2000 }));
  const exhaustionInput = (slots: number) => { const i = dataFixture({ keys: 32, count: 32, interval: 1, slots, connections: 32, sessions: 1, activeTransactions: 1, dbCpu: 3000, ttl: 100000 }), q = quantities(); const p = i.paths.find((p) => p.target === "db")!; p.pool.maxConnections = q.q("exhaustion.pool", 1, "count"); p.pool.acquireTimeout = q.q("exhaustion.acquire", 1000, "us"); i.ledger.push(...q.ledger); return i; };
  const delayedExhaustion = (slots: number) => { const i = exhaustionInput(slots), q = quantities(); const arrival = i.arrivals[0]!; if (arrival.kind !== "trace") arrival.start = q.q("exhaustion.start", 4000, "us"); i.ledger.push(...q.ledger); return run(i); };
  const exhausted = delayedExhaustion(32), moreWorkers = delayedExhaustion(64);
  const contention = (same: boolean) => {
    const i = dataFixture({ keys: 8, sessions: 8, activeTransactions: 8 }), d = database(i), v = quantities(); d.execution.cores = v.q("contention.cores", 4, "cores"); d.plans.heavy!.commitWait = v.q("contention.ack", 1000, "us"); d.plans.heavy!.durability = "authored-log-ack";
    const kernel = new EventKernel(100000), db = relationalDatabase(d, kernel), results: Array<{ id: string; at: number }> = []; let peakWaiting = 0;
    for (let n = 0; n < 8; n++) { const id = JSON.stringify([n]); db.accept({ callId: id, rootId: id, operation: "heavy", attempt: 0, offeredAt: 0, sessionId: id, message: { request: { kind: "query", key: `k${same ? 0 : n}` } } }, () => results.push({ id, at: kernel.now })); peakWaiting = Math.max(peakWaiting, db.evidence().waiters.length); }
    kernel.advanceTo(100000); return { sameKey: same, offered: 8, offeredAt: 0, peakWaiting, results, database: db.evidence(), ledger: [...i.ledger, ...v.ledger] };
  };
  const detached = run(dataFixture({ keys: 1, count: 10, interval: 1, slots: 16, timeout: 500, dbCpu: 1000, ttl: 100000 }));
  const proof = { normal, cacheFailure, databaseFailure: run(dbOut), stampede, coalesced, capacity, ttl, exhausted, moreWorkers, independent: contention(false), conflicting: contention(true), detached };
  if (cacheFailure.data.applications[0]!.databaseFetches <= normal.data.applications[0]!.databaseFetches || stampede.data.applications[0]!.databaseFetches <= coalesced.data.applications[0]!.databaseFetches || proof.conflicting.peakWaiting <= proof.independent.peakWaiting || !capacity.data.caches[0]!.evictions || !ttl.data.caches[0]!.expirations || !proof.detached.data.databases[0]!.transactions.committed) throw Error("M2E proof mechanism disappeared");
  return proof;
}
if (import.meta.main) {
  const report = dataProofs(), file = new URL("../../docs/reality/m2e-proofs.json", import.meta.url);
  if (process.argv.includes("--write")) writeFileSync(file, JSON.stringify(report, null, 2) + "\n"); else if (JSON.stringify(report) !== JSON.stringify(JSON.parse(readFileSync(file, "utf8")))) throw Error("M2E proof drift");
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([id, value]) => [id, "counts" in value ? { counts: value.counts, fetches: value.data.applications[0]!.databaseFetches, hits: value.data.caches[0]!.hits, misses: value.data.caches[0]!.misses, evictions: value.data.caches[0]!.evictions, expirations: value.data.caches[0]!.expirations } : { peakWaiting: value.peakWaiting, results: value.results }]))));
}
