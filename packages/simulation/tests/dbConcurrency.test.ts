import { expect, test } from "bun:test";
import { hash, keyspaceDesign, prepareKeyspace } from "./keyspace.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

test("saved database query slots and queue capacity replace the frozen canvas budgets", () => {
  const d = keyspaceDesign(10);
  Object.assign(d.resources[2]!, { dbConcurrency: { version: 1, activeQueries: 1, queuedQueries: 2 } });
  const f = prepareKeyspace(d);
  expect(f.compiled.input.resources.find(r => r.kind === "relational")).toMatchObject({ activeTransactions: { value: 1 }, pendingQueries: { value: 2 }, maxSessions: { value: 100 } });
  expect(f.contract.transports.database!.pool).toEqual(prepareKeyspace(keyspaceDesign(10)).contract.transports.database!.pool);
});

test("partial settings retain the other authored budget and empty settings retain historical bytes", () => {
  for (const setting of [{ version: 1 as const, activeQueries: 2 }, { version: 1 as const, queuedQueries: 0 }]) {
    const d = keyspaceDesign(); d.resources[2]!.dbConcurrency = setting;
    const f = prepareKeyspace(d);
    expect(f.compiled.input.resources.find(r => r.kind === "relational")).toMatchObject({ activeTransactions: { value: setting.activeQueries ?? 16 }, pendingQueries: { value: setting.queuedQueries ?? 256 } });
  }
  const d = keyspaceDesign(), old = prepareKeyspace(d); d.resources[2]!.dbConcurrency = { version: 1 };
  const next = prepareKeyspace(d);
  expect(next.contract).toEqual(old.contract); expect(next.compiled).toEqual(old.compiled); expect(next.assumptions).toEqual(old.assumptions);
});

test("query concurrency requires matching captured intent, profile and materialized budgets", () => {
  const d = keyspaceDesign(); d.resources[2]!.dbConcurrency = { version: 1, activeQueries: 1, queuedQueries: 2 };
  expect(currentAdapterProfiles(d.resources)).toEqual(["data-db-concurrency/1"]);
  expect(contractFromDesign(d, { adapterProfiles: [] })).toHaveProperty("refused");
  expect(contractFromDesign(keyspaceDesign(), { adapterProfiles: ["data-db-concurrency/1"] })).toHaveProperty("refused");
  const missing = prepareKeyspace(d); missing.contract.version = missing.contract.version.replace("/data-db-concurrency/1", "");
  expect(compileProduct(d, missing.contract).ok).toBe(false);
  for (const field of ["activeTransactions", "pendingQueries"] as const) {
    const f = prepareKeyspace(d), db = f.contract.nodes.db!.resources.find(r => r.config.kind === "relational")!.config;
    if (db.kind !== "relational") throw Error("Expected database");
    const budget = db[field];
    if (budget.kind !== "known") throw Error("Expected database budget");
    budget.value++;
    const fact = f.contract.ledger.find(r => r.id === budget.provenance[0])!.quantity;
    if (fact.kind !== "known") throw Error("Expected numeric database fact"); fact.value++;
    const result = compileProduct(d, f.contract);
    expect(result.ok).toBe(false); expect(result.diagnostics.some(r => r.message.includes("Database query budgets must match"))).toBe(true);
  }
});

function burst(activeQueries: number, queuedQueries = 32, options: { cache?: number; hot?: boolean; singleFlight?: boolean; keys?: number; writes?: boolean } = {}) {
  const d = keyspaceDesign(options.keys ?? 100); d.workload.readWriteRatio = 1;
  d.resources[0]!.size = "large"; d.resources[2]!.size = "large";
  d.resources[2]!.dbConcurrency = { version: 1, activeQueries, queuedQueries };
  if (options.hot) d.resources[2]!.dataKeyspace!.accessPattern = "hot-key";
  if (options.cache !== undefined) d.resources[1]!.cachePolicy = { version: 2, capacityEntries: options.cache, singleFlight: options.singleFlight ?? false };
  else { d.resources.splice(1, 1); d.connections = [{ ...d.connections[1]!, sourceId: "app", sourceType: "Virtual Machine" }]; }
  const f = prepareKeyspace(d, "db-query-bursts");
  f.compiled.input.arrivals = [{ id: "query-bursts", kind: "trace", trace: {
    schema: "infraforge-arrivals/1", unit: "us", durationUs: 1000000, provenance: "Deterministic database execution contention proof",
    rows: Array.from({ length: 256 }, (_, i) => ({ id: String(i), atUs: Math.floor(i / 8) * 25000, operation: options.writes && i % 4 === 0 ? "write" : "read" })),
  } }];
  return { ...f, runtime: createProductModel2(f.compiled) };
}

function observe(f: ReturnType<typeof burst>) {
  let maxQueued = 0, maxActive = 0, queueAreaUs = 0;
  for (let t = 100; t <= 1000000; t += 100) {
    f.runtime.advanceTo(t);
    const state = f.runtime.inspect("db") as { queued: number; serving: number; waiting: number };
    maxQueued = Math.max(maxQueued, state.queued); maxActive = Math.max(maxActive, state.serving + state.waiting); queueAreaUs += state.queued * 100;
  }
  const e = f.runtime.evidence(), db = e.data.databases[0]!;
  const times = e.results.filter(r => r.outcome === "completed").map(r => r.responseUs).sort((a,b) => a-b);
  expect(e.resultRetention.omitted).toBe(0); expect(times).toHaveLength(e.counts.completed);
  return { maxQueued, maxActive, sampledQueueUs: queueAreaUs, p95Us: times[Math.ceil(times.length * 0.95) - 1], reads: db.logicalReads, writes: db.logicalWrites, refusals: db.reasons["query-queue-full"] ?? 0, completed: e.counts.completed, rejected: e.counts.rejected, evictions: e.data.caches[0]?.evictions, hits: e.data.caches[0]?.hits, coalesced: e.data.applications[0]?.coalescedWaiters };
}

for (const hot of [false, true]) test(`real execution slots control DB queueing and response time, hot=${hot}`, () => {
  const low = burst(1, 32, { hot }), high = burst(8, 32, { hot });
  const a = observe(low), b = observe(high);
  expect(a.completed).toBe(256); expect(b.completed).toBe(256);
  expect(a.refusals).toBe(0); expect(b.refusals).toBe(0);
  expect(a.maxQueued).toBeGreaterThan(0); expect(b.maxQueued).toBe(0);
  expect(a.maxActive).toBe(1); expect(b.maxActive).toBeLessThanOrEqual(8);
  expect(a.p95Us!).toBeGreaterThan(b.p95Us!); expect(a.sampledQueueUs).toBeGreaterThan(b.sampledQueueUs);
  expect(a.reads).toBe(256); expect(b.reads).toBe(256);
  console.info("db-slot-comparison", JSON.stringify({ hot, low: a, high: b }));
});

for (const queued of [0, 2]) test(`pending capacity ${queued} bounds real work and refuses a full queue`, () => {
  const f = burst(1, queued), result = observe(f), db = f.runtime.evidence().data.databases[0]!;
  expect(result.maxQueued).toBeLessThanOrEqual(queued); expect(result.maxActive).toBe(1);
  expect(result.refusals).toBeGreaterThan(0); expect(result.completed).toBeLessThan(256);
  expect(result.completed + result.rejected).toBe(256);
  expect(db.transactions.live).toBe(0); expect(db.sessions.total).toBeLessThanOrEqual(10);
  expect(db.sessionEvents?.refused).toBe(0);
  console.info("db-pending-bound", JSON.stringify({ queued, ...result }));
});

for (const hot of [false, true]) test(`cache capacity controls pressure reaching the same constrained DB, hot=${hot}`, () => {
  const small = observe(burst(1, 32, { hot, cache: 2, keys: 10 })), large = observe(burst(1, 32, { hot, cache: 100, keys: 10 }));
  expect(small.completed).toBe(256); expect(large.completed).toBe(256);
  expect(small.evictions!).toBeGreaterThan(0); expect(large.evictions).toBe(0);
  expect(small.reads).toBeGreaterThan(large.reads); expect(small.sampledQueueUs).toBeGreaterThan(large.sampledQueueUs);
  expect(large.hits!).toBeGreaterThan(small.hits!);
  console.info("db-cache-capacity-pressure", JSON.stringify({ hot, small, large }));
});

test("single-flight reduces real same-key database queue pressure", () => {
  const off = observe(burst(1, 32, { cache: 1, keys: 1 })), on = observe(burst(1, 32, { cache: 1, keys: 1, singleFlight: true }));
  expect(off.completed).toBe(256); expect(on.completed).toBe(256);
  expect(on.coalesced!).toBeGreaterThan(0); expect(on.reads).toBeLessThan(off.reads);
  expect(on.sampledQueueUs).toBeLessThan(off.sampledQueueUs);
  console.info("db-single-flight-pressure", JSON.stringify({ off, on }));
});

test("contended writes retain per-key versions and repeat exactly across advance sizes", () => {
  const a = burst(1, 32, { hot: true, keys: 10, cache: 2, writes: true }), b = burst(1, 32, { hot: true, keys: 10, cache: 2, writes: true });
  const result = observe(a); b.runtime.advanceTo(1000000);
  const e = a.runtime.evidence(), db = e.data.databases[0]!, writes = e.data.applications[0]!.results.filter(r => r.source === "write-invalidated");
  expect(result.completed).toBe(256); expect(result.maxQueued).toBeGreaterThan(0); expect(writes.length).toBe(64);
  for (const row of db.rows) expect(row.version).toBe(1 + writes.filter(w => w.key === row.key).length);
  expect(db.logicalWrites).toBe(64); expect(hash(e)).toBe(hash(b.runtime.evidence())); expect(a.compiled).toEqual(b.compiled);
});

