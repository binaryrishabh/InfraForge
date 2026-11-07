import { expect, test } from "bun:test";
import { cacheReportFixture } from "./cacheReport.fixture";

test("exact engine cache and helper populations survive report serialization; old absence is never backfilled", () => {
  const f = cacheReportFixture();
  expect(f.roundTrips).toEqual(f.reports);
  for (const [i, report] of f.reports.entries()) {
    const snapshot = f.captures[i]!;
    expect(report.terminal).not.toBeNull();
    for (const [id, metrics] of Object.entries(snapshot.metrics)) {
      const saved = report.terminal!.resources.find(r => r.id === id)!;
      expect(saved.cache).toEqual(metrics.cache);
      expect(saved.applicationHelpers).toEqual(metrics.applicationHelpers);
    }
    const cache = snapshot.metrics.cache!.cache!;
    const helpers = Object.values(snapshot.metrics).flatMap(m => m.applicationHelpers?.helpers ?? []);
    expect(helpers.length).toBeGreaterThan(0);
    expect(helpers.every(h => h.cacheId === "cache" && h.databaseId === "db")).toBe(true);
    expect(cache.coalescedWaiters).toBe(helpers.reduce((sum, h) => sum + h.coalescedWaiters!, 0));
    expect(cache.hits! + cache.misses!).toBeGreaterThan(snapshot.traffic!.offeredRps);
    console.info(JSON.stringify({lab: report.challenge!.challengeId, variant: i % 2 ? "reference" : "starter", cache,
      helpers, p95: snapshot.traffic!.latencyMs.p95, callers: snapshot.traffic!.wholeRun, verdict: report.challenge!.status}));
  }
  expect(f.reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met", "met"]);
  const ttl = f.reports.slice(0, 2).map(r => r.terminal!.resources.find(r => r.cache)!.cache!);
  expect(ttl[0]!.expirations!).toBeGreaterThan(0); expect(ttl[1]!.expirations).toBe(0);
  expect(ttl[1]!.hits!).toBeGreaterThan(ttl[0]!.hits!);
  const coalescing = f.reports.slice(2).map(r => r.terminal!.resources.flatMap(r => r.applicationHelpers?.helpers ?? [])[0]!);
  expect(coalescing[0]!.coalescedWaiters).toBe(0); expect(coalescing[1]!.coalescedWaiters!).toBeGreaterThan(0);
  expect(coalescing[1]!.databaseFetches!).toBeLessThan(coalescing[0]!.databaseFetches!);
  expect(f.missing.terminal).not.toBeNull();
  expect(f.missing.terminal!.resources.every(r => !r.cache && !r.applicationHelpers)).toBe(true);
  expect(f.unknown.terminal!.resources.find(r => r.cache)!.cache!.hits).toBeNull();
  expect(f.invalid.terminal).toBeNull(); expect(f.duplicateHelper.terminal).toBeNull();
}, 180000);
