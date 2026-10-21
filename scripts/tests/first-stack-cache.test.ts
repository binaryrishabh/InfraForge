import { expect, test } from "bun:test";
import { firstStackCacheFixture } from "../fixtures/first-stack-cache";
import { prepareFirstStackExecution, runFirstStackQualification } from "../../apps/backend/firstStack/execution";
import { reviewSidecar } from "../../apps/backend/firstStack/authoring";
import type { CausalEvent } from "../../packages/simulation/src/model2/workload/causal";
import { cacheProof } from "../reality/first-stack-cache-proof";
import { readFileSync } from "node:fs";
import { cacheBaselineSource, cacheMechanismPaths, verifyCacheReview } from "../stage2-cache-identity";

test("cache host reconstruction refuses every unreviewed mechanism edit", () => {
  expect(() => verifyCacheReview()).not.toThrow();
  for (const path of cacheMechanismPaths) expect(() => cacheBaselineSource(path, readFileSync(path, "utf8") + "\n")).toThrow("Unreviewed cache mechanism drift");
});

test("fresh cache graphs retain their recorded-key proof", async () => {
  expect(await cacheProof()).toEqual(JSON.parse(readFileSync("docs/reality/first-stack-cache-proof.json", "utf8")));
}, 60000);

test("three exact same-key misses conserve compute, pools and actual saved DB reads with/without coalescing", async () => {
  for (const coalesce of [true, false]) {
    const f = await firstStackCacheFixture({ coalesce }), prepared = f.prepare(), events: CausalEvent[] = [];
    const off = runFirstStackQualification(prepared), on = runFirstStackQualification(prepared, e => events.push(structuredClone(e)));
    expect(on).toEqual(off);
    expect(off.evidence.counts).toMatchObject({ offered: 3, completed: 3, rejected: 0 });
    const cache = off.evidence.data.caches[0]!, aside = off.evidence.data.applications[0]!;
    expect(cache).toMatchObject({ hits: 0, misses: 3, fills: coalesce ? 1 : 3 });
    expect(aside).toMatchObject({ databaseFetches: coalesce ? 1 : 3, coalescedWaiters: coalesce ? 2 : 0,
      recordedKeys: { savedDatabaseReads: coalesce ? 2 : 0, fillAcknowledged: coalesce ? 1 : 3 } });
    expect(events.filter(e => e.kind === "db-admitted" && e.work?.operation === "health")).toHaveLength(1);
    expect(events.filter(e => e.kind === "db-admitted" && e.work?.operation === "read")).toHaveLength(coalesce ? 1 : 3);
    expect(off.evidence.data.databases[0]!.logicalReads).toBe((coalesce ? 1 : 3) + 1);
    expect(off.evidence.composition.cpu.find(h => h.id === "host-app-0")!.appCoreUs).toBe(1210);
    expect(off.evidence.composition.bindings.some((b: { resource: string }) => b.resource.includes("cache-policy"))).toBe(false);
    expect(off.evidence.network.paths.find(p => p.id === "app-0:policy-db")!.completed).toBe(coalesce ? 1 : 3);
    expect(aside.results.every(r => r.key === "hot")).toBe(true);
    expect(off.evidence.firstStack).toMatchObject({ fullMemory: "Unknown", activeEngine: "1", cache: { policyCpuUs: "Unknown" } });
  }
});

test("warm hits save DB work across 1/2/8 apps and explicit policy overhead is charged once", async () => {
  for (const apps of [1, 2, 8]) {
    const f = await firstStackCacheFixture({ apps, warm: true, policyCpuUs: 7 });
    const e = runFirstStackQualification(f.prepare()).evidence;
    expect(e.data.caches[0]).toMatchObject({ hits: 3, misses: 0, fills: 0 });
    expect(e.data.databases[0]!.logicalReads).toBe(apps);
    expect(e.composition.cpu.filter(h => h.id.startsWith("host-app")).reduce((s, h) => s + h.appCoreUs, 0)).toBe(3 * 407 + apps * 10);
    expect(e.data.applications.reduce((s, a) => s + a.recordedKeys!.savedDatabaseReads, 0)).toBe(3);
  }
});

test("recorded expiry and capacity policies produce misses/fills, never a fixed hit ratio", async () => {
  const rows = ["hot", "hot", "cold", "hot"].map((key, i) => ({ id: `r${i}`, atUs: 5000 + i * 5000, key }));
  const expired = await firstStackCacheFixture({ rows, ttlUs: 1000, warm: true });
  const ex = runFirstStackQualification(expired.prepare()).evidence.data.caches[0]!;
  expect(ex.hits).toBe(0); expect(ex.misses).toBe(4); expect(ex.expirations).toBeGreaterThan(0);
  for (const eviction of ["lru", "no-eviction"] as const) {
    const f = await firstStackCacheFixture({ rows, capacityBytes: 3, eviction });
    const e = runFirstStackQualification(f.prepare()).evidence, c = e.data.caches[0]!;
    expect(e.counts.completed).toBe(4);
    expect(c).toMatchObject(eviction === "lru" ? { hits: 1, misses: 3, evictions: 2, allocationRefused: 0 } : { hits: 2, misses: 2, evictions: 0, allocationRefused: 1 });
  }
});

test("cache failure fallback runs real DB work and fail policy refuses without inventing a fill", async () => {
  const f = await firstStackCacheFixture({ cacheAlive: false });
  const e = runFirstStackQualification(f.prepare()).evidence;
  expect(e.counts.completed).toBe(3); expect(e.data.applications[0]).toMatchObject({ cacheFailures: 3, databaseFetches: 1, recordedKeys: { fillAttempts: 0 } });
  const failed = await firstStackCacheFixture({ cacheAlive: false, onFailure: "fail" });
  const fail = runFirstStackQualification(failed.prepare()).evidence;
  expect(fail.counts.rejected).toBe(3); expect(fail.data.applications[0]!.databaseFetches).toBe(0);
});

test("writes invalidate actual keys and subsequent reads return the committed version", async () => {
  const f = await firstStackCacheFixture({ warm: true, rows: [
    { id: "r0", atUs: 5000, key: "hot" }, { id: "r1", atUs: 10000, key: "hot", operation: "write" }, { id: "r2", atUs: 15000, key: "hot" }] });
  const e = runFirstStackQualification(f.prepare()).evidence;
  expect(e.data.caches[0]).toMatchObject({ hits: 1, misses: 1, invalidations: 1, fills: 1 });
  expect(e.data.applications[0]!.results.map(r => r.version)).toEqual([1, undefined, 2]);
  expect(e.data.applications[0]!.results[1]!.source).toBe("write-invalidated");
});

test("cache roles, directed paths, stale profile identities and Unknown bytes refuse at review", async () => {
  const f = await firstStackCacheFixture();
  const broken = structuredClone(f.sidecar); broken.cache.roles[0]!.internal.requestBytes = null;
  expect(reviewSidecar(f.layout, broken).ok).toBe(false);
  broken.cache.roles[0]!.policy = "db"; expect(reviewSidecar(f.layout, broken).ok).toBe(false);
  f.sidecar.cache.ttlUs++; expect(() => prepareFirstStackExecution("qualification", f.layout, f.sidecar, f.schedule, f.policy)).toThrow("Demand profile changed");
});


test("stale fills after a write cannot resurrect old cache state or capture later coalesced reads", async () => {
  const f = await firstStackCacheFixture({ readBlockingUs: 3000, rows: [
    { id: "r0", atUs: 5000, key: "hot" }, { id: "r1", atUs: 6000, key: "hot", operation: "write" },
    { id: "r2", atUs: 7000, key: "hot" }, { id: "r3", atUs: 12000, key: "hot" }] });
  const e = runFirstStackQualification(f.prepare()).evidence;
  expect(e.counts.completed).toBe(4);
  expect(e.data.caches[0]).toMatchObject({ staleFillRefused: 1, invalidations: 1 });
  expect(e.data.applications[0]).toMatchObject({ databaseFetches: 3, coalescedWaiters: 0, recordedKeys: { fillRejected: 1 } });
  expect(e.data.applications[0]!.results.find(r => JSON.parse(r.root)[2] === "r3")!.version).toBe(2);
});


test("cache and finite IO require an explicit combined composition review", async () => {
  const { firstStackIoFixture } = await import("../fixtures/first-stack-io");
  const { createFirstStackRuntime } = await import("../../packages/simulation/src/firstStack/run");
  const cache = await firstStackCacheFixture(), io = await firstStackIoFixture();
  expect(() => createFirstStackRuntime(cache.sidecar, cache.schedule, cache.policy, undefined, io.profile)).toThrow("Cache plus finite IO requires a separately reviewed composition revision");
});
