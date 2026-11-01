import { expect, test } from "bun:test";
import { hash, keyspaceDesign, prepareKeyspace } from "./keyspace.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

function design(capacityEntries: number, count = 100, hot = false, ttlSeconds = 60, singleFlight = false) {
  const d = keyspaceDesign(count); d.workload.readWriteRatio = 1;
  Object.assign(d.resources[1]!, { cachePolicy: { version: 2, capacityEntries, ttlSeconds, singleFlight } });
  if (hot) d.resources[2]!.dataKeyspace!.accessPattern = "hot-key";
  return d;
}

test("learner capacity compiles entries plus overhead into the existing byte-budget LRU", () => {
  for (const capacity of [1, 10, 100, 1000]) {
    const d = design(capacity), f = prepareKeyspace(d);
    const cache = f.compiled.input.resources.find(r => r.kind === "cache")!;
    expect(cache).toMatchObject({ kind: "cache", semantics: "keyed-cache/1", policy: "lru", capacity: { value: capacity * (1024 + 64), unit: "bytes" }, entryOverhead: { value: 64 } });
    expect(currentAdapterProfiles(d.resources)).toEqual(["data-keyspace/1", "data-cache-capacity/1"]);
    expect(f.contract.ledger.find(r => r.id === "cache.capacity")!.classification).toBe("derived");
  }
});

test("capacity profile must match captured intent and compiled capacity, row size and overhead", () => {
  const d = design(10);
  expect(contractFromDesign(d, { adapterProfiles: ["data-keyspace/1"] })).toHaveProperty("refused");
  expect(contractFromDesign(keyspaceDesign(), { adapterProfiles: ["data-cache-capacity/1"] })).toHaveProperty("refused");
  const f = prepareKeyspace(d); f.contract.version = f.contract.version.replace("/data-cache-capacity/1", "");
  expect(compileProduct(d, f.contract).ok).toBe(false);
  for (const field of ["capacity", "entryOverhead"] as const) {
    const g = prepareKeyspace(d), c = g.contract.nodes.cache!.resources.find(r => r.config.kind === "cache")!.config;
    if (c.kind !== "cache" || c[field].kind !== "known") throw Error("Expected keyed cache quantity");
    c[field].value!++;
    expect(compileProduct(d, g.contract).ok).toBe(false);
  }
  const g = prepareKeyspace(d), db = g.contract.nodes.db!.resources.find(r => r.config.kind === "relational")!.config;
  if (db.kind !== "relational" || db.initial[0]!.bytes.kind !== "known") throw Error("Expected modeled row");
  db.initial[0]!.bytes.value++;
  expect(compileProduct(d, g.contract).ok).toBe(false);
});

test("same uniform and hot-key workloads show fewer real evictions and database reads with more capacity", () => {
  const outcomes = [false, true].map(hot => [10, 100, 1000].map(capacity => {
    const d = design(capacity, 100, hot); d.workload.targetThroughput = 6000;
    const f = prepareKeyspace(d, "capacity-comparison"); f.runtime.advanceTo(10000000); const warm = f.runtime.evidence();
    f.runtime.advanceTo(20000000); const e = f.runtime.evidence(), c = e.data.caches[0]!, db = e.data.databases[0]!;
    expect(e.counts.completed).toBe(2000); expect(c.expirations).toBe(0); expect(c.invalidations).toBe(0);
    expect(c.allocationRefused).toBe(0); expect(c.entries.length).toBeLessThanOrEqual(capacity);
    expect(c.misses).toBe(db.logicalReads); expect(c.fills).toBe(db.logicalReads);
    expect(c.allocatedEntryBytes).toBe(c.entries.length * 1088);
    if (capacity >= 100) {
      expect(c.evictions).toBe(0); expect(db.logicalReads).toBe(c.entries.length);
      expect(db.logicalReads - warm.data.databases[0]!.logicalReads).toBe(c.entries.length - warm.data.caches[0]!.entries.length);
    }
    else expect(c.evictions).toBeGreaterThan(0);
    return { hot, capacity, bytes: c.capacityBytes, evictions: c.evictions, misses: c.misses, dbReads: db.logicalReads };
  }));
  for (const row of outcomes) { expect(row[0]!.dbReads).toBeGreaterThan(row[1]!.dbReads); expect(row[1]!.dbReads).toBe(row[2]!.dbReads); }
  expect(outcomes[1]![0]!.dbReads).toBeLessThan(outcomes[0]![0]!.dbReads);
  console.info("cache-capacity-comparison", JSON.stringify(outcomes));
});

test("real LRU removes the least recently used key and accessing an evicted key reads the database again", () => {
  const f = prepareKeyspace(design(3, 10), "capacity-lru"); let previous = f.runtime.evidence(), refetches = 0, evictions = 0;
  const removed = new Set<string>();
  for (let i = 0; i < 200; i++) {
    f.runtime.advanceTo(i * 100000 + 50000); const e = f.runtime.evidence(), c = e.data.caches[0]!, p = previous.data.caches[0]!, result = e.data.applications[0]!.results.at(-1)!;
    expect(result.ok).toBe(true);
    if (c.evictions > p.evictions) {
      const victim = [...p.entries].sort((a, b) => a.sequence - b.sequence)[0]!;
      expect(c.evictions - p.evictions).toBe(1); expect(c.entries.some(r => r.key === victim.key)).toBe(false);
      removed.add(victim.key); evictions++;
    }
    if (removed.has(result.key) && !p.entries.some(r => r.key === result.key)) {
      expect(e.data.databases[0]!.logicalReads - previous.data.databases[0]!.logicalReads).toBe(1);
      expect(c.fills - p.fills).toBe(1); refetches++;
    }
    previous = e;
  }
  expect(evictions).toBeGreaterThan(0); expect(refetches).toBeGreaterThan(0);
  console.info("cache-capacity-refetch", JSON.stringify({ evictions, refetches }));
});

test("TTL expiry and capacity eviction retain separate real counters", () => {
  const cases = [[1, 1, 1], [3, 10, 60], [3, 10, 1]].map(([capacity, count, ttl]) => {
    const f = prepareKeyspace(design(capacity!, count!, true, ttl!), "capacity-expiry"); f.runtime.advanceTo(10000000);
    const c = f.runtime.evidence().data.caches[0]!; return { evictions: c.evictions, expirations: c.expirations };
  });
  expect(cases[0]!.expirations).toBeGreaterThan(0); expect(cases[0]!.evictions).toBe(0);
  expect(cases[1]!.evictions).toBeGreaterThan(0); expect(cases[1]!.expirations).toBe(0);
  expect(cases[2]!.evictions).toBeGreaterThan(0); expect(cases[2]!.expirations).toBeGreaterThan(0);
  console.info("cache-capacity-expiry", JSON.stringify(cases));
});

for (const appOwned of [false, true]) test(`single-flight coalesces real fills under capacity pressure, app-owned=${appOwned}`, () => {
  const outcomes = [false, true].map(on => {
    const d = design(2, 10, true, 60, on); d.resources[0]!.size = "large";
    if (appOwned) d.connections = [d.connections[0]!, { ...d.connections[1]!, sourceId: "app", sourceType: "Virtual Machine" }];
    const f = prepareKeyspace(d, "capacity-bursts");
    f.compiled.input.arrivals = [{ id: "capacity-bursts", kind: "trace", trace: {
      schema: "infraforge-arrivals/1", unit: "us", durationUs: 4000000, provenance: "Deterministic capacity pressure proof",
      rows: Array.from({ length: 256 }, (_, i) => ({ id: String(i), atUs: Math.floor(i / 8) * 100000, operation: "read" })),
    } }];
    const runtime = createProductModel2(f.compiled); runtime.advanceTo(4000000); const e = runtime.evidence();
    expect(e.counts.completed).toBe(256); expect(e.data.caches[0]!.evictions).toBeGreaterThan(0);
    expect(e.data.caches[0]!.expirations).toBe(0); expect(e.data.applications[0]!.fillsInProgress).toBe(0);
    expect(e.data.applications[0]!.databaseFetches).toBe(e.data.databases[0]!.logicalReads);
    return { reads: e.data.databases[0]!.logicalReads, waiters: e.data.applications[0]!.coalescedWaiters };
  });
  expect(outcomes[0]!.waiters).toBe(0); expect(outcomes[1]!.waiters).toBeGreaterThan(0);
  expect(outcomes[1]!.reads).toBeLessThan(outcomes[0]!.reads);
  console.info("cache-capacity-single-flight", JSON.stringify({ appOwned, outcomes }));
});

test("writes invalidate only the selected key while LRU pressure continues", () => {
  const d = design(3, 10, true, 60, true); d.workload.readWriteRatio = 0.8;
  const f = prepareKeyspace(d, "capacity-writes"); let previous = f.runtime.evidence(), writes = 0;
  for (let i = 0; i < 200; i++) {
    f.runtime.advanceTo(i * 100000 + 50000); const e = f.runtime.evidence(), result = e.data.applications[0]!.results.at(-1)!;
    expect(result.ok).toBe(true);
    for (const row of e.data.databases[0]!.rows) expect(row.version).toBe(previous.data.databases[0]!.rows.find(r => r.key === row.key)!.version + Number(result.source === "write-invalidated" && result.key === row.key));
    if (result.source === "write-invalidated") {
      writes++; expect(e.data.caches[0]!.entries).toEqual(previous.data.caches[0]!.entries.filter(r => r.key !== result.key));
    }
    previous = e;
  }
  expect(writes).toBe(40); expect(previous.data.caches[0]!.invalidations).toBe(writes);
  expect(previous.data.caches[0]!.evictions).toBeGreaterThan(0);
});

test("capacity pressure repeats exactly with the same seed across advance sizes", () => {
  const d = design(3, 10, true, 1, true), a = prepareKeyspace(d, "capacity-repeat"), b = prepareKeyspace(d, "capacity-repeat");
  a.runtime.advanceTo(10000000); for (let t = 50000; t <= 10000000; t += 50000) b.runtime.advanceTo(t);
  expect(hash(a.runtime.evidence())).toBe(hash(b.runtime.evidence()));
  expect(a.compiled).toEqual(b.compiled);
});
