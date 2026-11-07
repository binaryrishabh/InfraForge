import { expect, test } from "bun:test";
import { cdnReportFixture } from "./cdnReport.fixture";

test("saved CDN counters retain exact engine owners and populations across JSON; unavailable aggregates refuse invention", () => {
  const f = cdnReportFixture();
  for (const c of f.cases) {
    const saved = c.report.terminal!.resources.find(r => r.id === "cdn")!.cdn!;
    for (const key of ["hits", "misses", "originRequests", "fills", "expirations", "evictions", "coalesced", "purged", "staleFills"] as const) expect(saved[key]).toBe(c.raw[key]);
    expect(c.report.checkpoint!.resources.find(r => r.id === "cdn")!.cdn).toEqual(saved);
    expect(saved["cdn-waiter-capacity"]).toBeNull();
    if (c.mode !== "waiter-limit") expect(saved.misses).toBe(saved.originRequests! + saved.coalesced!);
    console.info(JSON.stringify({mode: c.mode, saved}));
  }
  const byMode = (mode: string) => f.cases.find(c => c.mode === mode)!.raw;
  expect(byMode("expiry").expirations).toBeGreaterThan(0);
  expect(byMode("shared-fill").coalesced).toBeGreaterThan(0);
  expect(byMode("shared-fill").staleFills).toBe(1);
  expect(byMode("independent-fills").staleFills).toBe(4);
  expect(byMode("shared-fill").originRequests).toBeLessThan(byMode("independent-fills").originRequests);
  expect(byMode("shared-fill").entries[0]!.expiresAt).toBeGreaterThan(63_000_000); // fenced reply did not populate the cache
  expect(byMode("warm-purge").purged).toBe(1);
  expect(byMode("waiter-limit").misses).toBeGreaterThan(byMode("waiter-limit").originRequests + byMode("waiter-limit").coalesced);
  expect(f.missing.terminal!.resources.find(r => r.id === "cdn")!.cdn).toBeUndefined();
  expect(f.unknown.terminal!.resources.find(r => r.id === "cdn")!.cdn!.hits).toBeNull();
  for (const invalid of [...f.invalid, f.inventedRefusal]) expect(invalid.terminal).toBeNull();
});
