import { expect, test } from "bun:test";
import { cacheStampede, observeStampede } from "./cacheStampede.fixture";
import { createProductModel2 } from "../src/model2/product/run";

test("three VMs share a cache; expiry causes concurrent DB demand and single-flight reduces sessions and latency", () => {
  const off = observeStampede(cacheStampede()), on = observeStampede(cacheStampede({ singleFlight: true }));
  for (const r of [off, on]) {
    const e = r.evidence, lb = e.network.loadBalancers[0]!;
    expect(lb.backends).toHaveLength(3);
    expect(lb.backends.every(b => b.selected > 0)).toBe(true);
    expect(r.rows[0]!.reads).toBeGreaterThan(0);
    expect(r.rows[1]!.reads).toBe(r.rows[0]!.reads);
    expect(r.rows[2]!.reads).toBeGreaterThan(r.rows[1]!.reads);
    expect(e.data.caches[0]!.expirations).toBeGreaterThan(0);
    expect(e.data.applications.reduce((n, a) => n + a.databaseFetches, 0)).toBe(e.data.databases[0]!.logicalReads);
    expect(e.counts.completed + e.counts.rejected).toBe(e.counts.offered);
    expect(e.counts.inFlight).toBe(0);
    expect(e.resultRetention.omitted).toBe(0);
  }
  expect(on.evidence.counts.offered).toBe(off.evidence.counts.offered);
  expect(on.evidence.data.databases[0]!.logicalReads).toBeLessThan(off.evidence.data.databases[0]!.logicalReads);
  expect(on.evidence.data.databases[0]!.sessions.total).toBeLessThan(off.evidence.data.databases[0]!.sessions.total);
  expect(on.completedP95Us).toBeLessThan(off.completedP95Us);
  expect(on.evidence.counts.completed).toBeGreaterThan(off.evidence.counts.completed);
  console.info("three-vm-stampede", JSON.stringify([off, on].map(r => ({ rows: r.rows, completed: r.evidence.counts.completed, reads: r.evidence.data.databases[0]!.logicalReads, completedP95Us: r.completedP95Us }))));
});

test("only TTL or entry capacity changes downstream DB reads in the same three-VM scenario", () => {
  const short = observeStampede(cacheStampede({ singleFlight: true }));
  const long = observeStampede(cacheStampede({ singleFlight: true, ttlSeconds: 60 }));
  expect(long.evidence.data.databases[0]!.logicalReads).toBeLessThan(short.evidence.data.databases[0]!.logicalReads);
  expect(long.evidence.data.caches[0]!.expirations).toBe(0);
  const small = observeStampede(cacheStampede({ singleFlight: true, ttlSeconds: 60, keys: 8, capacityEntries: 1 }));
  const larger = observeStampede(cacheStampede({ singleFlight: true, ttlSeconds: 60, keys: 8, capacityEntries: 16 }));
  expect(small.evidence.data.caches[0]!.evictions).toBeGreaterThan(0);
  expect(larger.evidence.data.caches[0]!.evictions).toBe(0);
  expect(larger.evidence.data.databases[0]!.logicalReads).toBeLessThan(small.evidence.data.databases[0]!.logicalReads);
  console.info("three-vm-cache-settings", JSON.stringify({ ttlReads: [short.evidence.data.databases[0]!.logicalReads, long.evidence.data.databases[0]!.logicalReads], capacityReads: [small.evidence.data.databases[0]!.logicalReads, larger.evidence.data.databases[0]!.logicalReads] }));
});

test("cache crash flushes warm state; recovery refills cold through the DB with deterministic bounded ownership", () => {
  const f = cacheStampede({ singleFlight: true, ttlSeconds: 60, crash: true });
  const r = observeStampede(f), e = r.evidence;
  expect(r.rows[1]!.reads).toBe(r.rows[0]!.reads);
  expect(r.rows[3]!.reads).toBeGreaterThan(r.rows[1]!.reads);
  expect(r.rows[4]!.reads).toBe(r.rows[3]!.reads);
  expect(r.rows[4]!.completed).toBeGreaterThan(r.rows[3]!.completed);
  expect(e.data.caches[0]!.epoch).toBe(1);
  expect(e.data.caches[0]!.logicallyLiveEntries).toBe(1);
  expect(e.data.applications.every(a => a.fillsInProgress === 0 && a.live === 0)).toBe(true);
  const replay = createProductModel2(f.compiled);
  for (let at = 250000; at <= replay.horizon; at += 250000) replay.advanceTo(at);
  expect(replay.evidence()).toEqual(e);
  console.info("three-vm-cache-recovery", JSON.stringify({ rows: r.rows, failedDuringOutage: e.counts.rejected, finalEntries: e.data.caches[0]!.logicallyLiveEntries }));
});
