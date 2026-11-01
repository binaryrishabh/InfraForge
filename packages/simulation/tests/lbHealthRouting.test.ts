import { expect, test } from "bun:test";
import { healthPolicy, healthScenario, observeHealth } from "./lbHealth.fixture";
import { hash } from "./keyspace.fixture";

test("failure threshold changes actual removal time, shifts traffic, and recovery restores routing", () => {
  const fast = observeHealth(healthScenario()), slow = observeHealth(healthScenario({ ...healthPolicy, unhealthyAfter: 3 }));
  expect(fast.removed).toBeNumber(); expect(slow.removed).toBeNumber();
  expect(slow.removed! - fast.removed!).toBe(2000000);
  for (const run of [fast, slow]) {
    const before = run.selected.filter(r => r.at < 1500000);
    expect(before.filter(r => r.detail === "app").length).toBeGreaterThan(0);
    expect(Math.abs(before.filter(r => r.detail === "app").length - before.filter(r => r.detail === "survivor").length)).toBeLessThanOrEqual(1);
    expect(run.selected.filter(r => r.at > run.removed! && r.at < run.returned! && r.detail === "app")).toHaveLength(0);
    expect(run.selected.filter(r => r.at > run.removed! && r.at < run.returned! && r.detail === "survivor").length).toBeGreaterThan(0);
    const restored = run.selected.filter(r => r.at > run.returned! + 1000000);
    expect(restored.filter(r => r.detail === "app").length).toBeGreaterThan(0);
    expect(Math.abs(restored.filter(r => r.detail === "app").length - restored.filter(r => r.detail === "survivor").length)).toBeLessThanOrEqual(1);
    const lb = run.evidence.network.loadBalancers[0]!;
    expect(lb.backends.every(b => b.health)).toBe(true);
    expect(lb.backends.reduce((n, b) => n + b.selected, 0)).toBe(lb.attempts);
  }
  expect(slow.selected.filter(r => r.at > fast.removed! && r.at < slow.removed! && r.detail === "app").length).toBeGreaterThan(0);
  const before = fast.selected.filter(r => r.at >= 250000 && r.at < 1250000 && r.detail === "survivor").length;
  const shifted = fast.selected.filter(r => r.at >= 5000000 && r.at < 6000000 && r.detail === "survivor").length;
  expect(shifted).toBe(before * 2);
  console.info("health-failure-threshold", JSON.stringify({ fast: fast.removed, slow: slow.removed, returned: fast.returned, survivorPerSecond: { before, shifted } }));
});

test("recovery threshold changes return-to-service time while failure timing stays identical", () => {
  const fast = observeHealth(healthScenario()), slow = observeHealth(healthScenario({ ...healthPolicy, healthyAfter: 3 }));
  expect(slow.removed).toBe(fast.removed); expect(slow.returned! - fast.returned!).toBe(2000000);
  expect(slow.selected.filter(r => r.at > fast.returned! && r.at < slow.returned! && r.detail === "app")).toHaveLength(0);
  expect(fast.selected.filter(r => r.at > fast.returned! && r.at < slow.returned! && r.detail === "app").length).toBeGreaterThan(0);
  console.info("health-recovery-threshold", JSON.stringify({ fast: fast.returned, slow: slow.returned }));
});

test("only a longer check interval delays detection of the same outage", () => {
  const fast = observeHealth(healthScenario()), slow = observeHealth(healthScenario({ ...healthPolicy, intervalSeconds: 3 }));
  expect(fast.removed).toBeNumber(); expect(slow.removed).toBeNumber(); expect(slow.removed!).toBeGreaterThan(fast.removed!);
  console.info("health-interval", JSON.stringify({ fast: fast.removed, slow: slow.removed }));
});

test("health timeout changes failed-check behavior on the same slow healthy path", () => {
  const policy = { ...healthPolicy, intervalSeconds: 3 };
  const short = observeHealth(healthScenario(policy, { fault: "delay", rps: 10 }));
  const long = observeHealth(healthScenario({ ...policy, timeoutSeconds: 2 }, { fault: "delay", rps: 10 }));
  expect(short.checks.some(r => r.detail === "health-timeout:eligible=false")).toBe(true);
  expect(long.checks.every(r => r.detail === "passed:eligible=true")).toBe(true);
  expect(short.removed).toBe(1000000); expect(short.returned).toBeNumber(); expect(long.removed).toBeUndefined();
  expect(long.selected.filter(r => r.detail === "app" && r.at > 1000000 && r.at < 7000000).length).toBeGreaterThan(0);
  expect(short.selected.filter(r => r.detail === "app" && r.at > short.removed! && r.at < short.returned!)).toHaveLength(0);
  console.info("health-timeout", JSON.stringify({ shortRemoved: short.removed, shortReturned: short.returned, longFirstCheck: long.checks[0] }));
});

test("routing to the remaining backend creates visible overload and recovery relieves it", () => {
  const healthy = observeHealth(healthScenario(healthPolicy, { rps: 200, readWriteRatio: 0, fault: "none" }));
  const outage = observeHealth(healthScenario(healthPolicy, { rps: 200, readWriteRatio: 0 }));
  const normal = healthy.views[5]!, shifted = outage.views[5]!, recovered = outage.views[13]!;
  expect(normal.metrics.survivor!.health).toBe("healthy");
  expect(shifted.metrics.survivor!.health).toBe("saturated");
  expect(shifted.metrics.survivor!.cpu!).toBeGreaterThanOrEqual(95);
  expect(shifted.latencyMs.p95!).toBeGreaterThan(normal.latencyMs.p95!);
  expect(recovered.metrics.survivor!.health).toBe("healthy");
  expect(recovered.metrics.survivor!.cpu!).toBeLessThan(shifted.metrics.survivor!.cpu!);
  expect(outage.selected.filter(r => r.at > outage.removed! && r.at < outage.returned! && r.detail === "app")).toHaveLength(0);
  console.info("health-survivor-overload", JSON.stringify({ normal, shifted, recovered }));
});

for (const resilience of ["retry", "breaker"] as const) test(`health exclusion and recovery remain coherent with ${resilience} and deterministic replay`, () => {
  const f = healthScenario({ ...healthPolicy, unhealthyAfter: 3 }, { resilience }), run = observeHealth(f);
  const e = run.evidence, lb = e.network.loadBalancers[0]!;
  expect(run.removed).toBeNumber(); expect(run.returned).toBeNumber();
  expect(run.selected.filter(r => r.at > run.removed! && r.at < run.returned! && r.detail === "app")).toHaveLength(0);
  expect(lb.attempts).toBeLessThanOrEqual(lb.received * 2); expect(lb.activeRetries).toBe(0);
  expect(lb.retriesWaiting).toBe(0); expect(lb.backends.every(b => b.health)).toBe(true);
  expect(e.counts.offered).toBe(e.counts.completed + e.counts.rejected + e.counts.deadlineExceeded + e.counts.abandoned + e.counts.inFlight);
  if (resilience === "retry") expect(lb.retries).toBeGreaterThan(0);
  else {
    const breaker = e.network.paths.find(p => p.source === "lb" && p.target === "app")!.circuitBreaker!;
    expect(breaker.transitions["closed->open"]).toBeGreaterThan(0);
    expect(breaker.rejected.open).toBeGreaterThan(0); expect(breaker.probes.succeeded).toBeGreaterThan(0); expect(breaker.state).toBe("closed");
    expect(lb.suppressedByReason!["non-retryable"]).toBeGreaterThan(0);
  }
  const replay = healthScenario({ ...healthPolicy, unhealthyAfter: 3 }, { resilience });
  replay.live.catchUp(16, 16);
  expect(hash(replay.live.evidence())).toBe(hash(e));
  console.info("health-resilience", JSON.stringify({ resilience, removed: run.removed, returned: run.returned, received: lb.received, attempts: lb.attempts, retries: lb.retries, suppressed: lb.suppressedByReason }));
});
