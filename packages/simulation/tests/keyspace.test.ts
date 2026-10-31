import { expect, test } from "bun:test";
import { hash, keyspaceDesign, prepareKeyspace } from "./keyspace.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { dataKeys } from "../src/model2/product/keyspace";

// Captured on unmodified 1c0629195c34806a5164d7ff385b96b20e487900. Never regenerate.
const historical = {
  contract: "9b4497a065db89fe32fcb0ac532a705e31168013945fbacce4869eb00dcb570e",
  compiled: "b7136b8b27952fe01a6d7a17363b3a866dc2e42288b660cf1266b201f2d2893e",
  evidence: "631dedf33a75ee3dd2c9e74e09936f7ea8477c2e0c38b3dc73b8b24ec28d277d",
};
for (const count of [undefined, 1]) test(`historical LF-normalized bytes remain pinned, keyspace=${count}`, () => {
  const f = prepareKeyspace(keyspaceDesign(count)); f.runtime.advanceTo(10000000);
  expect(hash(f.contract)).toBe(historical.contract);
  expect(hash(f.compiled)).toBe(historical.compiled);
  const e = f.runtime.evidence(); expect(hash(e)).toBe(historical.evidence);
  expect([...new Set(e.data.applications.flatMap(a => a.results.map(r => r.key)))]).toEqual(["key"]);
});
test("configured ten-key canvas executes multiple real keys", () => {
  const f = prepareKeyspace(keyspaceDesign(10)); f.runtime.advanceTo(10000000);
  const e = f.runtime.evidence();
  expect(e.data.databases[0]!.rows).toHaveLength(10);
  expect(new Set(e.data.applications[0]!.results.map(r => r.key)).size).toBeGreaterThan(1);
});

test("same seed and inputs reproduce key sequence and evidence digest across advance sizes", () => {
  const a = prepareKeyspace(keyspaceDesign(10), "uniform-a"), b = prepareKeyspace(keyspaceDesign(10), "uniform-a");
  a.runtime.advanceTo(10000000);
  for (let t = 250000; t <= 10000000; t += 250000) b.runtime.advanceTo(t);
  expect(hash(a.runtime.evidence())).toBe(hash(b.runtime.evidence()));
  const c = prepareKeyspace(keyspaceDesign(10), "uniform-b"); c.runtime.advanceTo(10000000);
  const sequence = (f: typeof a) => f.runtime.evidence().data.applications[0]!.results.map(r => r.key);
  expect(sequence(a)).not.toEqual(sequence(c));
  expect(hash(a.runtime.evidence())).not.toBe(hash(c.runtime.evidence()));
});

test("real cache hits, misses, selected-key writes and invalidation preserve other entries", () => {
  const f = prepareKeyspace(keyspaceDesign(10), "per-key-proof");
  let previous = f.runtime.evidence(), reads = 0, writes = 0, misses = 0;
  const written = new Set<string>();
  for (let i = 0; i < 100; i++) {
    f.runtime.advanceTo(i * 100000 + 50000);
    const e = f.runtime.evidence(), result = e.data.applications[0]!.results.at(-1)!;
    expect(result.ok).toBe(true);
    const beforeRows = new Map(previous.data.databases[0]!.rows.map(r => [r.key, r.version]));
    const beforeCache = new Map(previous.data.caches[0]!.entries.map(r => [r.key, r]));
    if (result.source === "write-invalidated") {
      writes++; written.add(result.key);
      for (const row of e.data.databases[0]!.rows) expect(row.version).toBe(beforeRows.get(row.key)! + Number(row.key === result.key));
      expect(e.data.caches[0]!.entries.some(r => r.key === result.key)).toBe(false);
      expect(e.data.caches[0]!.entries).toEqual(previous.data.caches[0]!.entries.filter(r => r.key !== result.key));
    } else {
      reads++;
      expect(result.source).toBe(beforeCache.has(result.key) ? "cache-hit" : "database-fetch");
      if (!beforeCache.has(result.key)) misses++;
      expect(result.version).toBe(beforeRows.get(result.key));
      expect(e.data.databases[0]!.rows).toEqual(previous.data.databases[0]!.rows);
      expect(e.data.caches[0]!.entries.find(r => r.key === result.key)?.version).toBe(result.version);
    }
    previous = e;
  }
  expect(written.size).toBeGreaterThan(1);
  expect(previous.data.caches[0]!.hits).toBe(reads - misses);
  expect(previous.data.caches[0]!.misses).toBe(misses);
  expect(previous.data.caches[0]!.invalidations).toBe(writes);
  expect(previous.data.databases[0]!.logicalReads).toBe(misses);
  expect(previous.data.databases[0]!.logicalWrites).toBe(writes);
  expect(previous.data.databases[0]!.physicalBufferHits).toBe("Unknown");
  expect(previous.data.databases[0]!.storageDeviceLatency).toBe("Unknown");
  expect(previous.data.caches[0]!.residentProcessBytes).toStartWith("Unknown");
});

test("read-only warmup fills each distinct key once and later hits avoid the DB", () => {
  const d = keyspaceDesign(10); d.workload.readWriteRatio = 1;
  const f = prepareKeyspace(d); f.runtime.advanceTo(10000000); const e = f.runtime.evidence();
  expect(e.data.caches[0]!.entries).toHaveLength(10);
  expect(e.data.caches[0]!.misses).toBe(10);
  expect(e.data.databases[0]!.logicalReads).toBe(10);
  expect(e.data.caches[0]!.hits).toBeGreaterThan(80);
});

test("100-key working set evicts distinct entries from a three-entry cache", () => {
  const d = keyspaceDesign(100); d.workload.readWriteRatio = 1;
  const f = prepareKeyspace(d), config = f.contract.nodes.cache!.resources.find(r => r.role === "main")!.config;
  if (config.kind !== "cache" || config.capacity.kind !== "known") throw Error("Expected known cache entry budget");
  config.capacity.value = 3 * (1024 + 64);
  const fact = f.contract.ledger.find(r => r.id === config.capacity.provenance[0])!;
  fact.quantity = { ...config.capacity }; fact.formula = String(config.capacity.value);
  const compiled = compileProduct(d, f.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const runtime = createProductModel2(compiled.value); runtime.advanceTo(10000000); const e = runtime.evidence();
  const cache = e.data.caches[0]!;
  expect(new Set(e.data.applications[0]!.results.map(r => r.key)).size).toBeGreaterThan(40);
  expect(cache.entries).toHaveLength(3); expect(cache.evictions).toBeGreaterThan(40);
  expect(cache.allocatedEntryBytes).toBe(cache.capacityBytes);
  expect(cache.misses).toBe(e.data.databases[0]!.logicalReads);
  expect(new Set(cache.entries.map(r => r.key)).size).toBe(3);
});

for (const flow of [false, true]) for (const direct of [false, true]) test(`selected-key data paths execute, flow=${flow}, direct=${direct}`, () => {
  const d = keyspaceDesign(10);
  if (direct) {
    d.resources = d.resources.filter(r => r.type !== "Cache");
    d.connections = [{ id: "data", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 }];
  }
  if (flow) d.resources[0]!.applicationFlow = { schema: "application-flow/2", operations: {
    read: { steps: [{ id: "read", kind: "data", edge: d.connections[0]!.id, operation: "read" }] },
    write: { steps: [{ id: "write", kind: "data", edge: d.connections[0]!.id, operation: "write" }] },
  } };
  const f = prepareKeyspace(d); f.runtime.advanceTo(10000000); const e = f.runtime.evidence();
  expect(e.counts.completed).toBeGreaterThan(90);
  expect(e.data.databases[0]!.rows).toHaveLength(10);
  expect(e.data.databases[0]!.rows.filter(r => r.version > 1).length).toBeGreaterThan(1);
  if (!direct) expect(new Set(e.data.applications[0]!.results.map(r => r.key)).size).toBe(10);
});

test("separate app cache and DB links inherit the database keyspace", () => {
  const d = keyspaceDesign(10); d.connections[1]!.sourceId = "app"; d.connections[1]!.sourceType = "Virtual Machine";
  const f = prepareKeyspace(d); f.runtime.advanceTo(10000000);
  expect(new Set(f.runtime.evidence().data.applications[0]!.results.map(r => r.key)).size).toBe(10);
});

test("multi-key profiles require captured intent; historical inputs never gain a profile", () => {
  expect(currentAdapterProfiles(keyspaceDesign().resources)).toEqual([]);
  expect(currentAdapterProfiles(keyspaceDesign(1).resources)).toEqual([]);
  expect(currentAdapterProfiles(keyspaceDesign(10).resources)).toEqual(["data-keyspace/1"]);
  expect(contractFromDesign(keyspaceDesign(10), { adapterProfiles: [] })).toHaveProperty("refused");
  expect(contractFromDesign(keyspaceDesign(1), { adapterProfiles: ["data-keyspace/1"] })).toHaveProperty("refused");
});

test("bounded stable key generation and mismatched DB contracts refuse", () => {
  expect(dataKeys(keyspaceDesign(1000).resources[2]!)).toHaveLength(1000);
  const d = keyspaceDesign(10), f = prepareKeyspace(d), db = f.contract.nodes.db!.resources[0]!.config;
  if (db.kind !== "relational") throw Error("Expected relational");
  db.plans.read!.statements[0]!.keys = ["key-1"];
  expect(compileProduct(d, f.contract).ok).toBe(false);
  for (const count of [0, -1, 1.5, 1001, NaN, Infinity]) expect(() => dataKeys({ ...d.resources[2]!, dataKeyspace: { version: 1, count } })).toThrow();
});

test("maximum learner keyspace compiles and runs within the product budgets", () => {
  const f = prepareKeyspace(keyspaceDesign(1000)); f.runtime.advanceTo(1000000);
  expect(f.runtime.evidence().data.databases[0]!.rows).toHaveLength(1000);
  expect(f.runtime.evidence().counts.completed).toBeGreaterThan(0);
});
