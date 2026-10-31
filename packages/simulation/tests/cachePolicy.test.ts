import { expect, test } from "bun:test";
import { hash, keyspaceDesign, prepareKeyspace } from "./keyspace.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

// Captured before production edits on 3109981af5add926cd8b8529c795e9218344e94e. Never regenerate.
const accepted = [
  ["legacy", "1b3d3e00d716cb5de96a2cb96ef23230a12ec69e2e973fdc9e2f599e3b04583a", "e047aabf8afb4c3b5a02ee5ea4beaf4a82b6157445fe27bf15f7743f334bb87d", "32a0ab4f9112db79346711eefe2f9c3202756b156769901fddf26be4c0801521", "6077c1cc99715b3c49a2c988aeecc8189c45a5a1443f1936aa0e4eec97f61985"],
  ["uniform", "6834bda3eacefea6ccb2603f3b8870b90f7698d30409f452052040fcbbd56e27", "460c646bc0a2ff1c83616cd9f9c35495687a7d5053374948628d1cb8c2736cf6", "52ddbb87b36f422bc920b86885bcb7aefb374ac857833205e1951724810704bd", "d089bc6ff06135da189861f5954be6811042fcfb8d432840cab2117bb76fd419"],
  ["hot-key", "35097350037f933118a49c47b199a18158e7049f9634ad2c92bb45d824aaa52a", "835a1fa672887030c18417b8fd2b5c3e86081199bfeab28248ae1a326c979a71", "05890cfe5fdda0ac6d5f45b79bb124338676f8736d13876488c1a12f5749c94c", "1ff4580d6e6c6c305c9dbc5bd9ce8ff6e712369dbaa0c829254eec86bc968f9d"],
] as const;
for (const [mode, ...pins] of accepted) test(`accepted cache bytes and frozen defaults stay pinned: ${mode}`, () => {
  const d = keyspaceDesign(mode === "legacy" ? undefined : 10);
  if (mode === "hot-key") d.resources[2]!.dataKeyspace!.accessPattern = mode;
  const f = prepareKeyspace(d, "cache-policy-accepted"); f.runtime.advanceTo(10000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(pins);
  const cache = f.compiled.input.resources.find(r => r.kind === "cache")!;
  expect(cache.kind === "cache" && cache.ttl).toMatchObject({ value: 60000000 });
  expect(f.compiled.input.resources.filter(r => r.kind === "cache-aside").every(r => !r.coalesce)).toBe(true);
});

function policyDesign(ttlSeconds?: number, singleFlight?: boolean, count = 1, hot = false) {
  const d = keyspaceDesign(count); d.workload.readWriteRatio = 1;
  Object.assign(d.resources[1]!, { cachePolicy: { version: 1, ...(ttlSeconds === undefined ? {} : { ttlSeconds }), ...(singleFlight === undefined ? {} : { singleFlight }) } });
  if (hot) d.resources[2]!.dataKeyspace!.accessPattern = "hot-key";
  return d;
}

test("explicit default settings compile to exactly the absent settings without a new profile", () => {
  const d = keyspaceDesign(1); d.workload.readWriteRatio = 1;
  for (const setting of [{ version: 1 }, { version: 1, ttlSeconds: 60 }, { version: 1, singleFlight: false }, { version: 1, ttlSeconds: 60, singleFlight: false }]) {
    const explicit = structuredClone(d); Object.assign(explicit.resources[1]!, { cachePolicy: setting });
    expect(currentAdapterProfiles(explicit.resources)).toEqual([]);
    const old = prepareKeyspace(d), next = prepareKeyspace(explicit);
    expect(next.contract).toEqual(old.contract); expect(next.compiled).toEqual(old.compiled); expect(next.assumptions).toEqual(old.assumptions);
  }
});

test("saved short TTL really expires entries and refills; long TTL keeps the same row warm", () => {
  const runs = [1, 120].map(ttl => {
    const f = prepareKeyspace(policyDesign(ttl), "ttl-proof"); f.runtime.advanceTo(10000000);
    const e = f.runtime.evidence(), c = e.data.caches[0]!, db = e.data.databases[0]!;
    expect(e.counts.completed).toBe(100); expect(c.fills).toBe(db.logicalReads);
    expect(db.rows).toMatchObject([{ key: "key", version: 1 }]);
    return { fills: c.fills, expirations: c.expirations, dbReads: db.logicalReads };
  });
  expect(runs[0]!.fills).toBe(10); expect(runs[0]!.expirations).toBe(9);
  expect(runs[1]).toEqual({ fills: 1, expirations: 0, dbReads: 1 });
  console.info("cache-ttl-proof", JSON.stringify({ short: runs[0], long: runs[1] }));
});

// Identical deterministic bursts use the compiled canvas resources and policies without altering them.
function burst(singleFlight: boolean, count = 1, hot = false, appOwned = false) {
  const d = policyDesign(1, singleFlight, count, hot); d.resources[0]!.size = "large";
  if (appOwned) d.connections = [d.connections[0]!, { ...d.connections[1]!, sourceId: "app", sourceType: "Virtual Machine" }];
  const f = prepareKeyspace(d, "cache-burst");
  f.compiled.input.arrivals = [{ id: "cache-bursts", kind: "trace", trace: {
    schema: "infraforge-arrivals/1", unit: "us", durationUs: 5000000, provenance: "Deterministic cache policy proof",
    rows: Array.from({ length: 32 }, (_, i) => ({ id: String(i), atUs: Math.floor(i / 8) * 1500000, operation: "read" })),
  } }];
  return { d, ...f, runtime: createProductModel2(f.compiled) };
}
for (const appOwned of [false, true]) test(`concurrent same-key misses share a real fill only when enabled, app-owned=${appOwned}`, () => {
  const outcomes = [false, true].map(on => {
    const f = burst(on, 1, false, appOwned); f.runtime.advanceTo(5000000); const e = f.runtime.evidence(), a = e.data.applications[0]!;
    expect(e.counts.completed).toBe(32); expect(a.failed).toBe(0); expect(a.fillsInProgress).toBe(0);
    expect(a.databaseFetches).toBe(e.data.databases[0]!.logicalReads);
    expect(a.results.every(r => r.ok && r.key === "key" && r.version === 1)).toBe(true);
    return { dbReads: a.databaseFetches, waiters: a.coalescedWaiters, fills: e.data.caches[0]!.fills };
  });
  expect(outcomes[0]!.waiters).toBe(0); expect(outcomes[1]!.waiters).toBeGreaterThan(0);
  expect(outcomes[1]!.dbReads).toBeLessThan(outcomes[0]!.dbReads);
  expect(outcomes[1]!.dbReads).toBe(4);
  console.info("cache-single-flight-proof", JSON.stringify({ appOwned, off: outcomes[0], on: outcomes[1] }));
});

test("hot keys, short TTL and single-flight keep fills keyed and repeat across advance sizes", () => {
  const off = burst(false, 10, true), a = burst(true, 10, true), b = burst(true, 10, true);
  off.runtime.advanceTo(5000000); a.runtime.advanceTo(5000000);
  for (let t = 250000; t <= 5000000; t += 250000) b.runtime.advanceTo(t);
  const e = a.runtime.evidence(), c = e.data.caches[0]!, app = e.data.applications[0]!;
  expect(hash(e)).toBe(hash(b.runtime.evidence())); expect(e.counts.completed).toBe(32);
  expect(off.runtime.evidence().counts.completed).toBe(32);
  expect(new Set(app.results.map(r => r.key)).size).toBeGreaterThan(1);
  expect(c.expirations).toBeGreaterThan(0); expect(app.coalescedWaiters).toBeGreaterThan(0);
  expect(app.databaseFetches).toBeLessThan(off.runtime.evidence().data.applications[0]!.databaseFetches);
  expect(app.results.filter(r => r.key === "key-1").length / app.results.length).toBeGreaterThan(0.65);
  expect(app.results.every(r => r.ok && e.data.databases[0]!.rows.some(row => row.key === r.key && row.version === r.version))).toBe(true);
  expect(e.data.databases[0]!.rows.every(r => r.version === 1)).toBe(true);
  console.info("cache-hot-key-proof", JSON.stringify({ off: off.runtime.evidence().data.applications[0]!.databaseFetches, on: app.databaseFetches, waiters: app.coalescedWaiters, expirations: c.expirations }));
});

test("changed policies require a matching captured profile and matching compiled settings", () => {
  const d = policyDesign(1, true);
  expect(currentAdapterProfiles(d.resources)).toEqual(["data-cache-policy/1"]);
  expect(contractFromDesign(d, { adapterProfiles: [] })).toHaveProperty("refused");
  const f = prepareKeyspace(d), c = f.contract.nodes.cache!.resources.find(r => r.config.kind === "cache")!.config;
  if (c.kind !== "cache" || c.ttl.kind !== "known") throw Error("Expected TTL");
  c.ttl.value = 60000000; expect(compileProduct(d, f.contract).ok).toBe(false);
  const g = prepareKeyspace(d), aside = g.contract.nodes.cache!.resources.find(r => r.config.kind === "cache-aside")!.config;
  if (aside.kind !== "cache-aside") throw Error("Expected cache aside");
  aside.coalesce = false; expect(compileProduct(d, g.contract).ok).toBe(false);
  const h = prepareKeyspace(d); h.contract.version = h.contract.version.replace("/data-cache-policy/1", "");
  expect(compileProduct(d, h.contract).ok).toBe(false);
  expect(contractFromDesign(keyspaceDesign(), { adapterProfiles: ["data-cache-policy/1"] })).toHaveProperty("refused");
});

test("short TTL and single-flight preserve selected-key writes and invalidate only that key", () => {
  const d = policyDesign(1, true, 10, true); d.workload.readWriteRatio = 0.8;
  const f = prepareKeyspace(d, "cache-keyed-writes"); let previous = f.runtime.evidence(), writes = 0;
  for (let i = 0; i < 100; i++) {
    f.runtime.advanceTo(i * 100000 + 50000); const e = f.runtime.evidence(), result = e.data.applications[0]!.results.at(-1)!;
    expect(result.ok).toBe(true);
    for (const row of e.data.databases[0]!.rows) expect(row.version).toBe(previous.data.databases[0]!.rows.find(r => r.key === row.key)!.version + Number(result.source === "write-invalidated" && result.key === row.key));
    if (result.source === "write-invalidated") {
      writes++; expect(e.data.caches[0]!.entries).toEqual(previous.data.caches[0]!.entries.filter(r => r.key !== result.key));
    } else expect(result.version).toBe(e.data.databases[0]!.rows.find(r => r.key === result.key)!.version);
    previous = e;
  }
  expect(writes).toBe(20); expect(previous.data.databases[0]!.logicalWrites).toBe(writes);
});

test("canvas adapter and compiler reject cache policy outside its bounded schema", () => {
  const valid = policyDesign(1, true), f = prepareKeyspace(valid);
  for (const value of [null, {}, { version: 2 }, { version: 1, ttlSeconds: 0 }, { version: 1, ttlSeconds: 1.5 }, { version: 1, ttlSeconds: 3601 }, { version: 1, singleFlight: "on" }, { version: 1, eviction: "lru" }]) {
    const d = structuredClone(valid); Object.assign(d.resources[1]!, { cachePolicy: value });
    expect(contractFromDesign(d)).toHaveProperty("refused"); expect(compileProduct(d, f.contract).ok).toBe(false);
  }
});
