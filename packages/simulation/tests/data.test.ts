import { test, expect } from "bun:test";
import { createDataModel2 } from "../src/model2/data/run";
import { relationalDatabase } from "../src/model2/data/database";
import { EventKernel } from "../src/model2/time";
import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";
import type { DataInput, RelationalConfig, CacheConfig, AsideConfig, DataReply, DataRequest } from "../src/model2/data/contracts";
import { keyedCache } from "../src/model2/data/cache";
import { lockManager } from "../src/model2/data/locks";
import { resolveModel } from "../src/model2/registry";
import { keyedUniform } from "../src/model2/random";
import { requireKnown } from "../src/reality/quantity";
import type { Invocation } from "../src/model2/workload/contracts";
export const dataRun = (input: DataInput, batch?: number) => { const m = createDataModel2(input); if (batch) for (let t = batch; t < m.horizon; t += batch) m.advanceTo(t); m.advanceTo(m.horizon); return m.evidence(); };
const database = (i: DataInput) => i.resources.find((r) => r.kind === "relational") as RelationalConfig;
const cache = (i: DataInput) => i.resources.find((r) => r.kind === "cache") as CacheConfig;
function work(id: string, operation = "light", key = "k0"): Invocation { return { rootId: JSON.stringify(["root", "test", id]), callId: JSON.stringify([id]), operation, attempt: 0, offeredAt: 0, sessionId: id, message: { request: { kind: "query", key } } }; }
export function dataConservation(e: ReturnType<typeof dataRun>) {
  const c = e.counts; if (c.offered !== c.completed + c.rejected + c.deadlineExceeded + c.abandoned + c.inFlight) throw new Error("Caller conservation");
  for (const r of e.resources) if (r.received !== r.admitted + r.rejected || r.admitted !== r.completed + r.failed + r.cancelled + r.queued + r.serving + r.waiting) throw new Error(`Resource conservation ${r.id}`);
  for (const d of e.data.databases) {
    if (d.sessions.total !== d.sessions.active + d.sessions.idle || d.transactions.admitted !== d.transactions.committed + d.transactions.aborted + d.transactions.cancelled + d.transactions.live || d.cpu.appCoreUs + d.cpu.competitorCoreUs > d.cpu.availableCoreUs + 1e-5) throw new Error("Database conservation");
    for (const l of d.locks.held) if (l.owners.length > 1 && l.owners.some((o) => o.mode === "exclusive")) throw new Error("Incompatible lock owners");
  }
  for (const c of e.data.caches) {
    const config = e.dataConfiguration.find((r) => r.kind === "cache" && r.id === c.id) as CacheConfig;
    if (c.lookups !== c.hits + c.misses + c.lookupFailures + c.lookupCancelled + c.liveLookups || c.allocatedEntryBytes > c.capacityBytes || c.allocatedEntryBytes < 0 || c.entries.reduce((n, r) => n + r.bytes + requireKnown(config.entryOverhead, "bytes"), 0) !== c.allocatedEntryBytes) throw new Error("Cache conservation");
  }
}
test("cache-aside warms actual keys and returns versions through network transport", () => {
  const e = dataRun(dataFixture({ keys: 1, count: 10, interval: 1500, ttl: 100000 }));
  expect(e.counts.completed).toBe(10); expect(e.data.caches[0]!.hits).toBeGreaterThan(5); expect(e.data.databases[0]!.transactions.committed).toBeLessThan(5); expect(e.data.applications[0]!.results.some((r) => r.version === 1)).toBe(true); dataConservation(e);
});
test("TTL expiration, LRU capacity and no-eviction act on entries", () => {
  const ttl = dataRun(dataFixture({ keys: 1, count: 10, interval: 1500, ttl: 2000 })); expect(ttl.data.caches[0]!.expirations).toBeGreaterThan(0); expect(ttl.data.caches[0]!.fills).toBeGreaterThan(1); dataConservation(ttl);
  const input = dataFixture({ keys: 4, capacity: 160, count: 16, interval: 1000, ttl: 100000 });
  const evict = dataRun(input); expect(evict.data.caches[0]!.evictions).toBeGreaterThan(0); dataConservation(evict);
  cache(input).policy = "no-eviction"; const refuse = dataRun(input); expect(refuse.data.caches[0]!.allocationRefused).toBeGreaterThan(0); expect(refuse.data.caches[0]!.evictions).toBe(0); dataConservation(refuse);
});
test("singleflight removes duplicate actual backing queries for an absent hot key", () => {
  const plain = dataRun(dataFixture({ keys: 1, count: 30, interval: 1, slots: 64, coalesce: false, dbCpu: 1000 }));
  const joined = dataRun(dataFixture({ keys: 1, count: 30, interval: 1, slots: 64, coalesce: true, dbCpu: 1000 }));
  expect(joined.data.applications[0]!.coalescedWaiters).toBeGreaterThan(0); expect(plain.data.applications[0]!.databaseFetches).toBeGreaterThan(joined.data.applications[0]!.databaseFetches); dataConservation(plain); dataConservation(joined);
});
test("ordinary snapshot reads do not take writer locks; conflicting writes wait until commit", () => {
  const i = dataFixture(), d = database(i), q = quantities(); d.execution.cores = q.q("db.test.cores", 4, "cores"); d.plans.heavy!.commitWait = q.q("db.test.commit", 1000, "us"); d.plans.heavy!.durability = "authored-log-ack";
  const kernel = new EventKernel(10000), db = relationalDatabase(d, kernel), writer = work("writer", "heavy"), reader = work("reader"), second = work("second", "heavy");
  db.accept(writer, () => {}); kernel.advanceTo(100); db.accept(reader, () => {}); db.accept(second, () => {}); kernel.advanceTo(1000);
  expect((reader.message!.response as DataReply).rows![0]!.version).toBe(1); expect(db.evidence().waiters.length).toBe(1); kernel.advanceTo(10000); expect(db.evidence().rows.find((r) => r.key === "k0")!.version).toBe(3); expect(db.evidence().durableAcknowledgedCommits).toBe(2);
});
test("transactions hold multiple locks, detect real deadlock and abort a deterministic requester", () => {
  const d = database(dataFixture()), plan = d.plans.heavy!;
  d.plans.light = { ...structuredClone(plan), statements: [ { ...plan.statements[0]!, keys: ["k0"] }, { ...plan.statements[0]!, keys: ["k1"] } ] };
  d.plans.heavy = { ...structuredClone(plan), statements: [ { ...plan.statements[0]!, keys: ["k1"] }, { ...plan.statements[0]!, keys: ["k0"] } ] };
  const kernel = new EventKernel(10000), db = relationalDatabase(d, kernel); db.accept(work("a"), () => {}); db.accept(work("b", "heavy"), () => {}); kernel.advanceTo(10000);
  expect(db.evidence().locks.deadlocks).toBe(1); expect(db.evidence().transactions.committed).toBe(1); expect(db.evidence().transactions.aborted).toBe(1); expect(db.evidence().locks.held).toHaveLength(0);
});
test("cache failure/flush drives real database work and recovers cold", () => {
  const input = dataFixture({ keys: 1, count: 30, interval: 500, ttl: 100000 }), q = quantities();
  input.networkInterventions.push({ id: "cache-outage", kind: "service-state", target: "cache", alive: true, ready: false, at: q.q("cache.outage.at", 4000, "us"), duration: q.q("cache.outage.duration", 4000, "us") });
  input.dataInterventions.push({ id: "flush", kind: "flush", target: "cache", at: q.q("cache.flush.at", 4000, "us") }); input.ledger.push(...q.ledger);
  const e = dataRun(input), normal = dataRun(dataFixture({ keys: 1, count: 30, interval: 500, ttl: 100000 })); expect(e.data.applications[0]!.databaseFetches).toBeGreaterThan(normal.data.applications[0]!.databaseFetches); expect(e.data.caches[0]!.fills).toBeGreaterThan(1); dataConservation(e);
});
test("server sessions differ from client leases; connection closure aborts its transaction", () => {
  const d = database(dataFixture({ sessions: 1 })), k = new EventKernel(10000), db = relationalDatabase(d, k); const a = work("a"), b = work("b");
  db.accept(a, () => {}); const receipt = db.accept(b, () => {}); expect(receipt.admitted).toBe(false); db.closeSession("a"); k.advanceTo(10000); expect(db.evidence().transactions.aborted).toBe(1); expect(db.evidence().sessions.total).toBe(0);
});

test("lock, statement and transaction timeouts roll back staged writes and release ownership", () => {
  for (const kind of ["lock", "statement", "transaction"] as const) {
    const d = database(dataFixture()), q = quantities(), p = d.plans.heavy!;
    if (kind === "lock") { p.commitWait = q.q("held.commit", 5000, "us"); p.durability = "authored-log-ack"; p.lockTimeout = q.q("short.lock", 200, "us"); }
    if (kind === "statement") p.statementTimeout = q.q("short.statement", 200, "us");
    if (kind === "transaction") { p.statements.push(structuredClone(p.statements[0]!)); p.transactionTimeout = q.q("short.transaction", 750, "us"); }
    const k = new EventKernel(10000), db = relationalDatabase(d, k); db.accept(work("a", "heavy"), () => {}); if (kind === "lock") db.accept(work("b", "heavy"), () => {}); k.advanceTo(10000);
    expect(db.evidence().reasons[`${kind}-timeout`]).toBe(1); expect(db.evidence().locks.held).toHaveLength(0);
    expect(db.evidence().rows[0]!.version).toBe(kind === "lock" ? 2 : 1);
  }
});

test("ordinary reads see committed statement snapshots and own staged writes; inserts require explicit bytes", () => {
  const d = database(dataFixture()), q = quantities(), p = d.plans.heavy!; p.statements.push({ ...structuredClone(d.plans.light!.statements[0]!) });
  d.keys.push("new"); d.plans.light!.statements = [{ ...structuredClone(p.statements[0]!), kind: "insert", keys: ["new"], insertBytes: q.q("insert.bytes", 128, "bytes") }];
  const k = new EventKernel(10000), db = relationalDatabase(d, k), w = work("write", "heavy"); db.accept(w, () => {}); db.accept(work("insert"), () => {}); k.advanceTo(5000);
  expect((w.message!.response as DataReply).rows![0]!.version).toBe(2); expect(db.evidence().rows.find((r) => r.key === "new")!.bytes).toBe(128);
  db.accept(work("duplicate"), () => {}); k.advanceTo(10000); expect(db.evidence().reasons["unique-conflict"]).toBe(1);
});

test("FIFO upgrade dependencies form real deadlocks and requester cancellation drains the queue", () => {
  const locks = lockManager(); let victim = ""; locks.acquire("a", "x", "shared", () => {}, () => {}); locks.acquire("b", "x", "shared", () => {}, () => {});
  locks.acquire("a", "x", "exclusive", () => {}, () => {}); locks.acquire("b", "x", "exclusive", () => {}, () => { victim = "b"; locks.release("b"); });
  expect(victim).toBe("b"); expect(locks.measure().deadlocks).toBe(1); expect(locks.waiters()).toHaveLength(0); locks.release("a"); expect(locks.measure().held).toHaveLength(0);
});

test("TTL is exact at expiry; invalidation and flush generations refuse in-flight stale fills", () => {
  const config = cache(dataFixture({ ttl: 100 })), k = new EventKernel(10000), c = keyedCache(config, k); let time = 0, n = 0;
  const command = (request: DataRequest) => { const w = work(String(n++)); w.message = { request }; c.accept(w, () => {}); k.advanceTo(time += 10); return w.message.response as DataReply; };
  const miss = command({ kind: "get", key: "k" }); command({ kind: "invalidate", key: "k" });
  expect(command({ kind: "set", key: "k", row: { version: 1, bytes: 64 }, token: miss.token }).reason).toBe("invalidated-fill");
  const after = command({ kind: "get", key: "k" }); c.flush(); expect(command({ kind: "set", key: "k", row: { version: 1, bytes: 64 }, token: after.token }).ok).toBe(false);
  command({ kind: "set", key: "k", row: { version: 2, bytes: 64 } }); expect(command({ kind: "get", key: "k" }).version).toBe(2);
  k.advanceTo(time = 160); expect(command({ kind: "get", key: "k" }).hit).toBe(false); expect(c.evidence().allocatedEntryBytes).toBe(0);
});

test("DB outage still permits real cached hits while misses fail, and cold service recovers", () => {
  const i = dataFixture({ count: 20, interval: 700, ttl: 100000, keys: 2 }), q = quantities(); cache(i).initial = [structuredClone(database(i).initial[0]!)];
  const path = i.paths.find((p) => p.target === "db")!; path.pool.responseTimeout = q.q("outage.response", 1000, "us"); path.pool.connectTimeout = q.q("outage.connect", 1000, "us");
  i.networkInterventions = [{ id: "db-outage", kind: "service-state", target: "db", alive: false, ready: false, at: q.q("db.outage.at", 0, "us"), duration: q.q("db.outage.duration", 7000, "us") }]; i.ledger.push(...q.ledger);
  const e = dataRun(i), during = e.data.applications[0]!.results.filter((r) => r.at < 7000);
  expect(during.some((r) => r.ok && r.source === "cache-hit")).toBe(true); expect(during.some((r) => !r.ok)).toBe(true); expect(e.data.databases[0]!.transactions.committed).toBeGreaterThan(0); dataConservation(e);
});

test("CPU and session capacity interventions constrain actual work; observations are immutable", () => {
  const i = dataFixture({ count: 16, interval: 100, dbCpu: 200, ttl: 200, keys: 4 }), q = quantities();
  i.dataInterventions = [{ id: "db-cpu", kind: "cpu-capacity", target: "db", at: q.q("capacity.at", 500, "us"), duration: q.q("capacity.duration", 2000, "us"), cores: q.q("capacity.cores", 0, "cores") }]; i.ledger.push(...q.ledger);
  const m = createDataModel2(i); m.advanceTo(2000); const early = m.evidence(); expect(early.data.databases[0]!.transactions.live).toBeGreaterThan(0); early.data.databases[0]!.rows.length = 0; m.advanceTo(m.horizon);
  const e = m.evidence(); expect(dataRun(i, 137)).toEqual(e); expect(e.data.databases[0]!.rows.length).toBe(4); dataConservation(e);
  const selected = resolveModel("2", { internal: true, workloadVersion: "m2e/1" }); expect(selected.workloadVersion).toBe("m2e/1"); expect(() => resolveModel("2")).toThrow("internal");
});

test("unknown demands, unbounded keys and unsupported session multiplexing are refused", () => {
  const a = dataFixture(); database(a).plans.light!.statements[0]!.cpu = { kind: "unknown", unit: "cpu-us", reason: "unmeasured", provenance: [] }; expect(() => createDataModel2(a)).toThrow();
  const b = dataFixture(), q = quantities(); b.paths.find((p) => p.target === "db")!.pool.streams = q.q("multiplex", 2, "count"); b.ledger.push(...q.ledger); expect(() => createDataModel2(b)).toThrow();
  const c = dataFixture(); database(c).keys.length = 0; expect(() => createDataModel2(c)).toThrow("dataset");
  const d = dataFixture(); database(d).execution.memory.coverage = "complete-model"; expect(() => createDataModel2(d)).toThrow("memory");
});

test("write invalidation changes returned versions; disabled invalidation exposes actual stale state; sampling is pure", () => {
  const make = (invalidate: boolean) => {
    const i = dataFixture({ keys: 1, ttl: 100000 }); (i.resources.find((r) => r.kind === "cache-aside") as AsideConfig).invalidateWrites = invalidate;
    i.arrivals = [{ id: "version-proof", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: 7000, provenance: "Synthetic M2E version/invalidation proof", rows: [{ id: "read", atUs: 0, operation: "light" }, { id: "write", atUs: 3000, operation: "heavy" }, { id: "reread", atUs: 6000, operation: "light" }] } }]; return i;
  };
  const freshInput = make(true), fresh = dataRun(freshInput), stale = dataRun(make(false));
  expect(fresh.data.databases[0]!.rows[0]!.version).toBe(2); expect(stale.data.databases[0]!.rows[0]!.version).toBe(2);
  expect(fresh.data.applications[0]!.results.at(-1)!.version).toBe(2); expect(stale.data.applications[0]!.results.at(-1)!.version).toBe(1); expect(fresh.data.caches[0]!.invalidations).toBe(1);
  const q = quantities(); freshInput.sampleInterval = q.q("different.samples", 137, "us"); freshInput.ledger.push(...q.ledger); const sampled = dataRun(freshInput); expect(sampled.data).toEqual(fresh.data); expect(sampled.results).toEqual(fresh.results); dataConservation(fresh); dataConservation(stale);
});

test("3000 deterministic data-plane cases conserve transactions, keys, bytes, CPU and callers", () => {
  for (let i = 0; i < 3000; i++) {
    const n = (purpose: string, max: number) => 1 + Math.floor(keyedUniform("m2e-sweep", "case", String(i), purpose) * max);
    const input = dataFixture({ count: n("count", 10), interval: n("arrival", 300), horizon: 8000, sample: 2000, raw: 20, keys: n("keys", 8), slots: n("workers", 12), connections: n("pool", 4), sessions: n("sessions", 4), activeTransactions: n("queries", 4), dbCpu: n("dbCpu", 600), ttl: n("ttl", 3000), capacity: n("capacity", 8) * 80, coalesce: i % 2 === 0, timeout: n("deadline", 6000), acquireTimeout: n("acquire", 4000), responseTimeout: n("response", 5000) }), q = quantities();
    const db = database(input), c = cache(input); c.policy = i % 3 ? "lru" : "no-eviction";
    for (const row of db.initial) row.bytes = q.q(`sweep.row.${row.key}`, n(`bytes.${row.key}`, 256), "bytes");
    const arrival = input.arrivals[0]!; if (i % 3 === 0 && arrival.kind !== "trace" && arrival.kind !== "rate") arrival.operation = "heavy";
    if (i % 5 === 0) db.plans.heavy!.statements.push(structuredClone(db.plans.heavy!.statements[0]!));
    if (i % 7 === 0) { db.plans.heavy!.durability = "authored-log-ack"; db.plans.heavy!.commitWait = q.q("sweep.commit", n("commit", 2000), "us"); }
    if (i % 11 === 0) input.dataInterventions.push({ id: "flush", kind: "flush", target: "cache", at: q.q("sweep.flush.at", n("flush", 3000), "us") });
    if (i % 13 === 0) input.networkInterventions.push({ id: "outage", kind: "service-state", target: i % 2 ? "db" : "cache", alive: false, ready: false, at: q.q("sweep.outage.at", n("outage", 2000), "us"), duration: q.q("sweep.outage.duration", n("duration", 2000), "us") });
    if (i % 17 === 0) input.dataInterventions.push({ id: "cpu", kind: "cpu-capacity", target: "db", at: q.q("sweep.cpu.at", 1000, "us"), duration: q.q("sweep.cpu.duration", 2000, "us"), cores: q.q("sweep.cpu.cores", 0.25, "cores") });
    if (i % 19 === 0) input.dataInterventions.push({ id: "sessions", kind: "session-capacity", target: "db", at: q.q("sweep.sessions.at", 500, "us"), duration: q.q("sweep.sessions.duration", 2000, "us"), sessions: q.q("sweep.sessions.count", 0, "count") });
    input.ledger.push(...q.ledger); const m = createDataModel2(input); m.advanceTo(1700); dataConservation(m.evidence()); m.advanceTo(m.horizon); const e = m.evidence(); dataConservation(e);
    if (i % 100 === 0) expect(dataRun(input, 113)).toEqual(e);
  }
}, 120000);
