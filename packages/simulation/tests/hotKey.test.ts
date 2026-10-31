import { expect, test } from "bun:test";
import { hash, keyspaceDesign, prepareKeyspace } from "./keyspace.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { EventKernel } from "../src/model2/time";
import { relationalDatabase } from "../src/model2/data/database";
import type { Invocation } from "../src/model2/workload/contracts";
import type { DataReply } from "../src/model2/data/contracts";

// Captured on the untouched accepted Data Depth 1 head 6aa1716. Never regenerate.
const uniformPins = [
  [10, "47a1d8f8806483689eeb1d8f5cf0523d03686fdc5b4730a1e0cf303bd8f266f2", "0d362ff3af103aa2a862140cbdb82caae29cf34da557f9cb719ff2125f47d500", "52ddbb87b36f422bc920b86885bcb7aefb374ac857833205e1951724810704bd", "3f6b95827ff9c329757721d05c8a85520606dc404c9609dd8daa950b15886085"],
  [100, "1e9f76553fd4a97c8bdae3fc7f2f88ad2e642d15a65bf0008449caa6785136b6", "2663d4452692022b92c2c6c58c71b65a2daaaa598304ac8f4b64410451502624", "6b54e43a263fcac305365a7795ea02422b68f385891692c34e74fb1cbb940a34", "9542fb592ce678273b71e64209a71aaa5c79bd0c8c1b824a99728a6a099ce5e6"],
  [1000, "6c6b6eb31be11a512fdc347d708f2bd93802dd90d47fef6d308d97408fa78bf1", "03b9e28c623ca99eb11e1a519a167405fdbc83f8fa459bb38443ec0fcbdb3691", "8ee4ef52575b9566599f537d927bf94f9b6522ae6ccad1e8289c49e53e114e9f", "1cd3cf843b9259c08c8dc7740added2876dce34ee25fd6c06be9f70c68cf6fbe"],
] as const;
for (const [count, ...pins] of uniformPins) test(`accepted uniform bytes remain pinned, count=${count}`, () => {
  for (const explicit of [false, true]) {
    const d = keyspaceDesign(count);
    if (explicit) Object.assign(d.resources[2]!.dataKeyspace!, { accessPattern: "uniform" });
    const f = prepareKeyspace(d, "uniform-accepted"); f.runtime.advanceTo(10000000);
    expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(pins);
  }
});

function hotDesign(count = 100) {
  const d = keyspaceDesign(count);
  Object.assign(d.resources[2]!.dataKeyspace!, { accessPattern: "hot-key" });
  return d;
}
const counts = (keys: string[]) => keys.reduce<Record<string, number>>((all, key) => { all[key] = (all[key] ?? 0) + 1; return all; }, {});

for (const flow of [false, true]) for (const direct of [false, true]) test(`hot-key requests concentrate real selected-key DB writes, flow=${flow}, direct=${direct}`, () => {
  const d = hotDesign(); d.workload.readWriteRatio = 0; d.workload.targetThroughput = 6000;
  if (direct) {
    d.resources = d.resources.filter(r => r.type !== "Cache");
    d.connections = [{ id: "data", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 }];
  }
  if (flow) d.resources[0]!.applicationFlow = { schema: "application-flow/2", operations: {
    write: { steps: [{ id: "write", kind: "data", edge: d.connections[0]!.id, operation: "write" }] },
  } };
  const f = prepareKeyspace(d, "hot-proof"); f.runtime.advanceTo(10000000); const e = f.runtime.evidence();
  const writes = Object.fromEntries(e.data.databases[0]!.rows.map(r => [r.key, r.version - 1]));
  const total = Object.values(writes).reduce((a, b) => a + b, 0);
  expect(total).toBe(1000); expect(writes["key-1"]! / total).toBeGreaterThan(0.74); expect(writes["key-1"]! / total).toBeLessThan(0.86);
  expect(Object.values(writes).filter(n => n > 0).length).toBeGreaterThan(60);
  expect(e.data.databases[0]!.logicalWrites).toBe(total);
  if (!direct) {
    const selected = counts(e.data.applications[0]!.results.map(r => r.key));
    for (const [key, count] of Object.entries(writes)) expect(count).toBe(selected[key] ?? 0);
  }
});

test("hot-key cache hits and misses reflect the same selected DB keys", () => {
  const d = hotDesign(10), f = prepareKeyspace(d, "per-key-hot");
  let previous = f.runtime.evidence(), hits = 0, misses = 0, writes = 0;
  for (let i = 0; i < 100; i++) {
    f.runtime.advanceTo(i * 100000 + 50000); const e = f.runtime.evidence(), result = e.data.applications[0]!.results.at(-1)!;
    expect(result.ok).toBe(true);
    if (result.source === "write-invalidated") {
      writes++;
      for (const row of e.data.databases[0]!.rows) expect(row.version).toBe(previous.data.databases[0]!.rows.find(r => r.key === row.key)!.version + Number(row.key === result.key));
      expect(e.data.caches[0]!.entries).toEqual(previous.data.caches[0]!.entries.filter(r => r.key !== result.key));
    } else {
      const hit = previous.data.caches[0]!.entries.some(r => r.key === result.key);
      if (hit) hits++; else misses++;
      expect(result.source).toBe(hit ? "cache-hit" : "database-fetch");
      expect(result.version).toBe(previous.data.databases[0]!.rows.find(r => r.key === result.key)!.version);
      expect(e.data.databases[0]!.rows).toEqual(previous.data.databases[0]!.rows);
    }
    previous = e;
  }
  expect(hits).toBeGreaterThan(0); expect(misses).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0);
  expect(previous.data.caches[0]!.hits).toBe(hits); expect(previous.data.caches[0]!.misses).toBe(misses);
  expect(previous.data.databases[0]!.logicalReads).toBe(misses); expect(previous.data.databases[0]!.logicalWrites).toBe(writes);
});

test("a three-entry cache produces different real hot-key and uniform outcomes", () => {
  const outcomes = [keyspaceDesign(100), hotDesign()].map(d => {
    d.workload.readWriteRatio = 1; d.workload.targetThroughput = 6000;
    const f = prepareKeyspace(d, "hot-v-uniform"), config = f.contract.nodes.cache!.resources.find(r => r.role === "main")!.config;
    if (config.kind !== "cache" || config.capacity.kind !== "known") throw Error("Expected cache budget");
    config.capacity.value = 3 * (1024 + 64);
    const fact = f.contract.ledger.find(r => r.id === config.capacity.provenance[0])!;
    fact.quantity = { ...config.capacity }; fact.formula = String(config.capacity.value);
    const compiled = compileProduct(d, f.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const run = createProductModel2(compiled.value); run.advanceTo(10000000); const e = run.evidence(), cache = e.data.caches[0]!;
    expect(e.counts.completed).toBe(1000); expect(cache.entries).toHaveLength(3); expect(cache.misses).toBe(e.data.databases[0]!.logicalReads);
    return { hits: cache.hits, misses: cache.misses, dbReads: e.data.databases[0]!.logicalReads };
  });
  expect(outcomes[1]!.hits).toBeGreaterThan(700); expect(outcomes[0]!.hits).toBeLessThan(100);
  expect(outcomes[1]!.dbReads).toBeLessThan(outcomes[0]!.dbReads / 3);
  console.info("hot-v-uniform", JSON.stringify({ uniform: outcomes[0], hot: outcomes[1] }));
});

test("hot-key repeats across advance sizes, preserves arrivals and changes valid sequences with the seed", () => {
  const a = prepareKeyspace(hotDesign(), "repeat-hot"), b = prepareKeyspace(hotDesign(), "repeat-hot"), c = prepareKeyspace(hotDesign(), "other-hot");
  a.runtime.advanceTo(10000000); c.runtime.advanceTo(10000000);
  for (let t = 250000; t <= 10000000; t += 250000) b.runtime.advanceTo(t);
  expect(hash(a.runtime.evidence())).toBe(hash(b.runtime.evidence()));
  expect(hash(a.runtime.evidence())).not.toBe(hash(c.runtime.evidence()));
  const uniform = prepareKeyspace(keyspaceDesign(100), "repeat-hot");
  expect(a.compiled.input.arrivals).toEqual(uniform.compiled.input.arrivals);
  for (const f of [a, b, c]) expect(counts(f.runtime.evidence().data.applications[0]!.results.map(r => r.key))["key-1"]).toBeGreaterThan(65);
});

test("hot-key profiles require matching captured intent only when behavior changes", () => {
  expect(currentAdapterProfiles(hotDesign().resources)).toEqual(["data-keyspace/1", "data-hot-key/1"]);
  expect(currentAdapterProfiles(hotDesign(1).resources)).toEqual([]);
  const one = prepareKeyspace(hotDesign(1)), old = prepareKeyspace(keyspaceDesign(1));
  expect(one.contract).toEqual(old.contract); expect(one.compiled).toEqual(old.compiled);
  expect(contractFromDesign(hotDesign(), { adapterProfiles: ["data-keyspace/1"] })).toHaveProperty("refused");
  const f = prepareKeyspace(hotDesign());
  expect(compileProduct(keyspaceDesign(100), f.contract).ok).toBe(false);
  f.contract.version = f.contract.version.replace("/data-hot-key/1", "");
  expect(compileProduct(hotDesign(), f.contract).ok).toBe(false);
});

test("hot-key selection preserves supplied keys and refuses invalid recorded keys", () => {
  const config = prepareKeyspace(hotDesign(10)).compiled.input.resources.find(r => r.kind === "relational")!;
  if (config.kind !== "relational") throw Error("Expected database");
  const clock = new EventKernel(1000), db = relationalDatabase(config, clock, undefined, undefined, undefined, "recorded-hot");
  expect(db.openSession("proof")).toBe(true);
  for (const [i, key] of ["key-7", "", "outside"].entries()) {
    const work: Invocation = { rootId: JSON.stringify(["root", i]), callId: JSON.stringify(["proof", i]), sessionId: "proof", operation: "read", attempt: 0, offeredAt: clock.now, message: { request: { kind: "query", key } } };
    db.accept(work, () => {}); clock.advanceTo((i + 1) * 10000);
    const reply = work.message!.response as DataReply;
    expect(reply.ok).toBe(key === "key-7");
    if (reply.ok) expect(reply.rows?.map(r => r.key)).toEqual(["key-7"]);
    else expect(reply.reason).toBe("key-outside-dataset");
  }
});

test("cache-aside cannot silently use uniform selection against a hot-key database", () => {
  const d = hotDesign(), f = prepareKeyspace(d), aside = f.contract.nodes.cache!.resources.find(r => r.role === "aside")!.config;
  if (aside.kind !== "cache-aside") throw Error("Expected aside");
  aside.access = "keyed-uniform";
  expect(compileProduct(d, f.contract).ok).toBe(false);
});
