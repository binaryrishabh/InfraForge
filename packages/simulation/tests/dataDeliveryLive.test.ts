import { expect, test } from "bun:test";
import { createLiveModel2 } from "../src/model2/product/live";
import { createProductModel2 } from "../src/model2/product/run";
import { keyspaceDesign, prepareKeyspace, hash } from "./keyspace.fixture";
import { cdnSetup } from "./cdnTtl.fixture";
import { prepare } from "./asyncCanvas.fixture";
import { dataDeliveryLive } from "../src/model2/product/dataDeliveryLive";
import { productFixture } from "./productFixture";
import { compileProduct } from "../src/model2/product/compiler";

// LF-normalized hashes captured on untouched be88485da25f69a7033291f3907f50cd8351c11b. Never regenerate.
const pins = {
  data: ["9b4497a065db89fe32fcb0ac532a705e31168013945fbacce4869eb00dcb570e", "b7136b8b27952fe01a6d7a17363b3a866dc2e42288b660cf1266b201f2d2893e", "32a0ab4f9112db79346711eefe2f9c3202756b156769901fddf26be4c0801521", "7688edc5b00348b7a5702a223825a6180ed0ee5b020639dcd7a660706a743290"],
  cdn: ["467009837f1af833c39a3986635742206a595c218d54d4921ea7b37fd0435454", "ff8405d74875eb8b48a3c901b5f18ce8c17a5006d75b44bded4bdc32dbcd3089", "602a492a3379d76595bc1e52bdfcd8c377a96a67646ecc61190bb894cf7479bf", "df068803840e86f98a834e3794b1663c9b4dc25c6beb74bf4bec07f0b0c53592"],
};

for (const mode of ["data", "cdn"] as const) test(`readout preserves released contract, compiled input, assumptions and evidence: ${mode}`, () => {
  const f = mode === "data" ? prepareKeyspace(keyspaceDesign()) : cdnSetup();
  f.runtime.advanceTo(1_000_000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(pins[mode]);
});

test("database and cache live readings use their own official evidence", () => {
  const d = keyspaceDesign(10);
  d.resources[2]!.dbConcurrency = { version: 1, activeQueries: 1, queuedQueries: 0 };
  d.resources[1]!.cachePolicy = { version: 2, capacityEntries: 2, ttlSeconds: 1, singleFlight: true };
  d.workload.targetThroughput = 7200;
  const f = prepareKeyspace(d), run = createLiveModel2(f.compiled, d.resources.map(r => r.id));
  run.advanceSecond();
  f.runtime.advanceTo(1_000_000);
  const m = run.project().metrics, e = run.evidence(), db = e.data.databases[0]!, cache = e.data.caches[0]!;
  expect(m.db!.database).toMatchObject({ version: 1, queued: db.queued, rejected: (f.runtime.inspect("db") as { rejected: number }).rejected });
  expect(m.db!.database!.rejected).toBeGreaterThanOrEqual(0);
  expect(m.cache!.cache).toEqual({ version: 1, hits: cache.hits, misses: cache.misses, expirations: cache.expirations, evictions: cache.evictions, coalescedWaiters: e.data.applications.reduce((n, a) => n + a.coalescedWaiters, 0) });
  expect(m.cache!.database).toBeUndefined(); expect(m.db!.cache).toBeUndefined(); expect(m.app!.cache).toBeUndefined();
});

test("CDN reads the official counters and keeps an unrecorded refusal count Unknown", () => {
  const f = cdnSetup(), run = createLiveModel2(f.compiled, f.saved.resources.map(r => r.id));
  for (let second = 0; second < 4; second++) {
    run.advanceSecond();
    const m = run.project().metrics, cdn = run.evidence().systems.cdns[0]!;
    expect(m.cdn!.cdn).toEqual({ version: 1, hits: cdn.hits, misses: cdn.misses, originRequests: cdn.originRequests, fills: cdn.fills, expirations: cdn.expirations, evictions: cdn.evictions, coalesced: cdn.coalesced, purged: cdn.purged, staleFills: cdn.staleFills, "cdn-waiter-capacity": null });
    expect(m.store!.cdn).toBeUndefined();
  }
});

test("one-shot and stepped runs have identical final evidence and data delivery views", () => {
  for (const f of [prepareKeyspace(keyspaceDesign(10)), cdnSetup()]) {
    const ids = f.compiled.semantic.nodes.map(n => n.id), stepped = createLiveModel2(f.compiled, ids), oneShot = createLiveModel2(f.compiled, ids);
    let view;
    for (let second = 0; second < 4; second++) { stepped.advanceSecond(); view = stepped.project(); }
    oneShot.catchUp(3, 3); oneShot.advanceSecond();
    expect(oneShot.project()).toEqual(view);
    const official = createProductModel2(f.compiled); official.advanceTo(4_000_000);
    expect(stepped.evidence()).toEqual(official.evidence()); expect(oneShot.evidence()).toEqual(official.evidence());
  }
});

test("two databases and two caches in one design cannot exchange evidence", () => {
  const d = keyspaceDesign(10), second = keyspaceDesign(20);
  d.workload.targetThroughput = 72000;
  d.resources[2]!.dbConcurrency = { version: 1, activeQueries: 1, queuedQueries: 0 };
  d.resources[1]!.cachePolicy = { version: 2, capacityEntries: 1, singleFlight: true };
  second.resources[1]!.cachePolicy = { version: 2, capacityEntries: 20, singleFlight: false };
  d.resources.push(...second.resources.map(r => ({ ...r, id: `${r.id}2` })), { id: "lb", type: "Load Balancer", x: 0, y: 0 });
  d.connections.push(...second.connections.map(e => ({ ...e, id: `${e.id}-2`, sourceId: `${e.sourceId}2`, targetId: `${e.targetId}2` })), ...["app", "app2"].map(id => ({ id: `route-${id}`, sourceId: "lb", targetId: id, sourceType: "Load Balancer" as const, targetType: "Virtual Machine" as const, port: 80 })));
  const f = prepare(d), run = createLiveModel2(f.compiled, d.resources.map(r => r.id)), official = createProductModel2(f.compiled);
  for (let second = 0; second < 4; second++) run.advanceSecond();
  official.advanceTo(4_000_000);
  const m = run.project().metrics, e = official.evidence();
  for (const id of ["db", "db2"]) {
    const state = official.inspect(id) as { serving: number; waiting: number; queued: number; rejected: number; sessionRefused?: number };
    expect(m[id]!.database).toEqual({ version: 1, serving: state.serving, waiting: state.waiting, queued: state.queued, rejected: state.rejected, sessionRefused: state.sessionRefused ?? null, "query-queue-full": e.data.databases.find(r => r.id === id)!.reasons["query-queue-full"] ?? null });
    expect(m[id]!.cache).toBeUndefined(); expect(m[id]!.cdn).toBeUndefined();
  }
  for (const id of ["cache", "cache2"]) {
    const cache = e.data.caches.find(r => r.id === id)!;
    const helpers = f.compiled.input.resources.filter(r => r.kind === "cache-aside" && r.cache === id);
    expect(m[id]!.cache).toEqual({ version: 1, hits: cache.hits, misses: cache.misses, expirations: cache.expirations, evictions: cache.evictions, coalescedWaiters: helpers.reduce((sum, h) => sum + e.data.applications.find(a => a.id === h.id)!.coalescedWaiters, 0) });
    expect(m[id]!.database).toBeUndefined(); expect(m[id]!.cdn).toBeUndefined();
  }
  expect(m.cache!.cache!.hits).not.toBe(m.cache2!.cache!.hits);
  expect(m.db!.database!.rejected).not.toBe(m.db2!.database!.rejected);
});

test("two CDNs keep separate counters in a compiled design with DB and cache", () => {
  const f = productFixture({ horizon: 1_000_000 });
  f.design.resources.push({ id: "cdn2", type: "CDN", x: 0, y: 0 });
  f.contract.nodes.cdn2 = structuredClone(f.contract.nodes.cdn!);
  f.contract.nodes.cdn2.identities[0]!.address = "192.0.2.200";
  for (const [id, sourceId, targetId, sourceType, targetType, template] of [
    ["origin2", "cdn2", "objects", "CDN", "Object Storage", "origin"],
    ["cdn2-client", "monitor", "cdn2", "Monitoring Agent", "CDN", "cdn-client"],
  ] as const) {
    f.design.connections.push({ id, sourceId, targetId, sourceType, targetType, port: 8080 });
    f.contract.edges[id] = structuredClone(f.contract.edges[template]!);
  }
  const request = f.contract.commands.find(c => c.id === "cdn")!;
  for (const [id, at, target] of [["hit1", 100_000, "$cdn"], ["hit2", 110_000, "$cdn"], ["other", 120_000, "$cdn2"]] as const) f.contract.commands.push({ ...structuredClone(request), id, target, at: f.q.q(`${id}.at`, at, "us") });
  const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const run = createLiveModel2(c.value, f.design.resources.map(r => r.id)); run.advanceSecond();
  const m = run.project().metrics, e = run.evidence();
  for (const id of ["cdn", "cdn2"]) {
    const cdn = e.systems.cdns.find(r => r.id === id)!;
    expect(m[id]!.cdn).toMatchObject({ hits: cdn.hits, misses: cdn.misses, originRequests: cdn.originRequests, fills: cdn.fills, expirations: cdn.expirations, coalesced: cdn.coalesced, purged: cdn.purged, staleFills: cdn.staleFills });
    expect(m[id]!.database).toBeUndefined(); expect(m[id]!.cache).toBeUndefined();
  }
  expect(m.cdn!.cdn!.hits).toBeGreaterThan(m.cdn2!.cdn!.hits!);
  expect(m.db!.cdn).toBeUndefined(); expect(m.cache!.cdn).toBeUndefined();
});

test("missing current state, evidence rows, fields and helper counters stay Unknown", () => {
  const f = prepareKeyspace(keyspaceDesign());
  const missing = { inspectData: { database: () => undefined, cache: () => undefined, application: () => undefined }, inspectCdn: () => undefined };
  for (const resource of f.compiled.input.resources.filter(r => r.kind === "cache" || r.kind === "relational")) {
    const readings = dataDeliveryLive(resource, missing, undefined, f.compiled.input.resources);
    for (const [key, value] of Object.entries(readings.cache ?? readings.database!)) expect(value).toBe(key === "version" ? 1 : null);
  }
  const c = cdnSetup();
  const resource = c.compiled.input.resources.find(r => r.kind === "cdn")!;
  for (const [key, value] of Object.entries(dataDeliveryLive(resource, missing, undefined, c.compiled.input.resources).cdn!)) expect(value).toBe(key === "version" ? 1 : null);
});
