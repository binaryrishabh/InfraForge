import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { gatewayQuotaBuckets } from "../src/model2/gateway/quota";
import { validateRuntimeGatewayQuota } from "../src/model2/gateway/quota";
import type { GatewayConfig } from "../src/model2/gateway/contracts";
import { quantities } from "./workloadFixture";

// Invariants of gateway-quota/1: shared scope is one conserved credit pool; per-route scope isolates routes; reading never spends.
const BURST = 3, PERIOD = 1000, ROUTES = 3;
function config(scope: "shared" | "per-route" | undefined, routes = ROUTES, burst = BURST): GatewayConfig {
  const { q } = quantities();
  return { id: "gateway", kind: "api-gateway", profile: "exact-route-gateway/1", ...(scope ? { quota: { profile: "gateway-quota/1" as const, scope } } : {}),
    routes: Array.from({ length: routes }, (_, i) => ({ id: `r${i}`, target: "app", path: `/r${i}`, method: "GET" as const, burst: q(`b${i}`, burst, "count"), refillEvery: q(`p${i}`, PERIOD, "us") })) } as unknown as GatewayConfig;
}
// Deterministic pseudo-random schedule of (time, route) takes: no Math.random, no Date.
function schedule(seed: number, count: number, routes: number) {
  let s = seed >>> 0, t = 0; const rows: Array<[number, number]> = [];
  const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < count; i++) { t += Math.floor(next() * 400); rows.push([t, Math.floor(next() * routes)]); }
  return rows;
}
function play(scope: "shared" | "per-route" | undefined, rows: Array<[number, number]>, only?: number) {
  const clock = new EventKernel(1_000_000), buckets = gatewayQuotaBuckets(config(scope), clock), admitted: number[] = Array(ROUTES).fill(0), times: number[][] = [[], [], []];
  for (const [t, route] of rows) {
    if (only !== undefined && route !== only) continue;
    clock.advanceTo(t); buckets.reading(route); buckets.reading((route + 1) % ROUTES); // reading in between must never spend a credit
    if (buckets.take(route)) { admitted[route]!++; times[route]!.push(t); }
  }
  return { admitted, times, end: rows.at(-1)![0], buckets, clock };
}

test("shared scope never admits more in total than one burst plus the refills that elapsed", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const rows = schedule(seed, 600, ROUTES), r = play("shared", rows), total = r.admitted.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(BURST + Math.floor(r.end / PERIOD));
    // Saturated demand must actually use the credits: nothing is silently withheld.
    expect(total).toBeGreaterThanOrEqual(BURST + Math.floor(r.end / PERIOD) - 2);
  }
});

test("per-route scope bounds each route by its own burst and refill, and routes cannot spend each other's credits", () => {
  for (const seed of [1, 2, 3]) {
    const rows = schedule(seed, 600, ROUTES), together = play("per-route", rows);
    for (let route = 0; route < ROUTES; route++) {
      expect(together.admitted[route]).toBeLessThanOrEqual(BURST + Math.floor(together.end / PERIOD));
      const alone = play("per-route", rows, route);
      expect(together.times[route]).toEqual(alone.times[route]); // identical admissions with or without the other routes' traffic
    }
  }
});

test("shared scope couples routes: one route's traffic removes credits another would have used", () => {
  const rows = schedule(7, 600, ROUTES), together = play("shared", rows), alone = play("shared", rows, 0);
  expect(together.admitted[0]).toBeLessThan(alone.admitted[0]!);
});

test("reading a route's budget never spends, refunds or changes the next admission", () => {
  const rows = schedule(11, 300, ROUTES);
  const plain = (() => { const clock = new EventKernel(1_000_000), b = gatewayQuotaBuckets(config("shared"), clock), out: boolean[] = []; for (const [t, r] of rows) { clock.advanceTo(t); out.push(b.take(r)); } return out; })();
  const watched = (() => { const clock = new EventKernel(1_000_000), b = gatewayQuotaBuckets(config("shared"), clock), out: boolean[] = []; for (const [t, r] of rows) { clock.advanceTo(t); for (let i = 0; i < ROUTES; i++) { b.reading(i).tokens = 999; } out.push(b.take(r)); } return out; })();
  expect(watched).toEqual(plain);
});

test("an unmarked gateway keeps independent per-route buckets exactly as before", () => {
  const rows = schedule(3, 600, ROUTES), unmarked = play(undefined, rows), perRoute = play("per-route", rows);
  expect(unmarked.times).toEqual(perRoute.times);
});

test("unequal or single-route budgets are refused at runtime, never reinterpreted", () => {
  const unequal = config("shared"); (unequal.routes[1] as { burst: unknown }).burst = quantities().q("x", BURST + 1, "count");
  expect(() => validateRuntimeGatewayQuota(unequal)).toThrow();
  expect(() => validateRuntimeGatewayQuota(config("per-route", 1))).toThrow();
  expect(() => validateRuntimeGatewayQuota({ ...config("shared"), quota: { profile: "gateway-quota/1", scope: "global" } } as unknown as GatewayConfig)).toThrow();
});
