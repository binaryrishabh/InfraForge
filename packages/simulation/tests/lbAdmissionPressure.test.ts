import { expect, test } from "bun:test";
import type { LbAdmission } from "@infraforge/domain/resource";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";
import { createProductModel2 } from "../src/model2/product/run";
import { hash } from "./keyspace.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { withTimeline } from "../src/model2/product/timeline";

function burst(setting: LbAdmission, resilience?: "retry" | "breaker") {
  const design = lbDesign(); design.resources[0]!.lbAdmission = setting;
  if (resilience) design.resources[0]!.retry = { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 1, retryOn: ["backendFailure"] };
  if (resilience === "breaker") design.resources[0]!.circuitBreaker = { enabled: true, failureThreshold: 1, cooldownMs: 20 };
  const f = prepareLb(design);
  if (resilience) {
    const contract = withTimeline(f.contract, [{ id: "crash", kind: "crash", node: "app", atUs: 1, durationUs: 10000, restartUs: 1 }]);
    const compiled = compileProduct(design, contract);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    f.contract = contract; f.compiled = compiled.value;
  }
  f.compiled.input.arrivals = [{ id: "admission-bursts", kind: "trace", trace: {
    schema: "infraforge-arrivals/1", unit: "us", durationUs: 1000000, provenance: "Deterministic load balancer admission proof",
    rows: Array.from({ length: 16 }, (_, i) => ({ id: String(i), atUs: Math.floor(i / 8) * 25000, operation: "read" })),
  } }];
  return { ...f, runtime: createProductModel2(f.compiled) };
}

function observe(f: ReturnType<typeof burst>) {
  let maxActive = 0, maxPending = 0, queueAreaUs = 0;
  for (let t = 100; t <= 1000000; t += 100) {
    f.runtime.advanceTo(t);
    const lb = f.runtime.inspect("lb") as { active: number; pending: number };
    maxActive = Math.max(maxActive, lb.active); maxPending = Math.max(maxPending, lb.pending); queueAreaUs += lb.pending * 100;
  }
  const e = f.runtime.evidence(), lb = e.network.loadBalancers[0]!;
  const failures = e.network.trace.events.filter(r => r.kind === "lb-failure");
  const times = e.results.filter(r => r.outcome === "completed").map(r => r.responseUs).sort((a,b) => a-b);
  expect(e.network.trace.omitted).toBe(0); expect(e.resultRetention.omitted).toBe(0);
  return { maxActive, maxPending, queueAreaUs, completed: e.counts.completed, rejected: e.counts.rejected,
    overflow: failures.filter(r => r.detail === "pending-overflow").length, timeouts: failures.filter(r => r.detail === "pending-timeout").length,
    attempts: lb.attempts, backendSelected: lb.backends.reduce((sum, b) => sum + b.selected, 0),
    appCoreUs: e.intervals.filter(r => r.resource === "app").reduce((sum, r) => sum + r.appCoreUs, 0),
    p95Us: times[Math.ceil(times.length * 0.95) - 1] };
}
const settings = { version: 1, maxActive: 1, maxQueued: 32, queueWaitMs: 1000 } as const;

test("one active limit change removes real LB pending pressure and latency when it is the limiter", () => {
  const low = observe(burst(settings)), high = observe(burst({ ...settings, maxActive: 8 }));
  expect(low.maxActive).toBe(1); expect(low.maxPending).toBeGreaterThan(0);
  expect(high.maxPending).toBe(0); expect(high.queueAreaUs).toBe(0); expect(high.maxActive).toBeLessThanOrEqual(8);
  expect(low.completed).toBe(16); expect(high.completed).toBe(16);
  expect(low.overflow + low.timeouts + high.overflow + high.timeouts).toBe(0);
  expect(low.p95Us!).toBeGreaterThan(high.p95Us!);
  expect(low.backendSelected).toBe(16); expect(high.backendSelected).toBe(16);
  expect(low.appCoreUs).toBeCloseTo(high.appCoreUs, 6);
  console.info("lb-active-comparison", JSON.stringify({ low, high }));
});

test("one queued limit change creates the engine's real overflow and reduces backend work", () => {
  const room = observe(burst(settings)), full = observe(burst({ ...settings, maxQueued: 0 }));
  expect(full.maxPending).toBe(0); expect(full.maxActive).toBe(1);
  expect(full.overflow).toBeGreaterThan(0); expect(full.timeouts).toBe(0);
  expect(full.completed + full.rejected).toBe(16); expect(full.completed).toBeLessThan(room.completed);
  expect(full.backendSelected).toBe(full.completed); expect(full.attempts).toBe(full.completed);
  expect(full.appCoreUs).toBeLessThan(room.appCoreUs);
  expect(room.appCoreUs - full.appCoreUs).toBe((room.completed - full.completed) * 3000);
  console.info("lb-pending-comparison", JSON.stringify({ room, full }));
});

test("one queue wait change causes real pending-timeout outcomes before forwarding", () => {
  const long = observe(burst(settings)), short = observe(burst({ ...settings, queueWaitMs: 1 }));
  expect(short.timeouts).toBeGreaterThan(0); expect(long.timeouts).toBe(0); expect(short.overflow).toBe(0);
  expect(short.completed + short.rejected).toBe(16); expect(short.backendSelected).toBe(short.completed);
  expect(short.appCoreUs).toBeLessThan(long.appCoreUs);
  console.info("lb-timeout-comparison", JSON.stringify({ long, short }));
});

test("one-shot and stepped advances retain identical compiled inputs and complete evidence hashes", () => {
  for (const setting of [settings, { ...settings, maxActive: 8 }, { ...settings, maxQueued: 0 }, { ...settings, queueWaitMs: 1 }]) {
    const a = burst(setting), b = burst(setting); observe(a); b.runtime.advanceTo(1000000);
    expect(hash(a.compiled)).toBe(hash(b.compiled)); expect(hash(a.runtime.evidence())).toBe(hash(b.runtime.evidence()));
  }
});

test("retries keep their active slot through backoff and cannot bypass either admission limit", () => {
  for (const maxQueued of [0, 32]) {
    const f = burst({ ...settings, maxQueued }, "retry");
    let backoffObserved = false, maxActive = 0, maxPending = 0, maxRetrying = 0, maxBackend = 0, minBackoffActive = Infinity;
    for (let t = 100; t <= 1000000; t += 100) {
      f.runtime.advanceTo(t);
      const lb = f.runtime.inspect("lb") as { active: number; pending: number; retriesWaiting: number; activeRetries: number; backends: { outstanding: number }[] };
      maxActive = Math.max(maxActive, lb.active); maxPending = Math.max(maxPending, lb.pending);
      maxRetrying = Math.max(maxRetrying, lb.activeRetries); maxBackend = Math.max(maxBackend, lb.backends[0]!.outstanding);
      if (lb.retriesWaiting > 0) { backoffObserved = true; minBackoffActive = Math.min(minBackoffActive, lb.active); }
    }
    const e = f.runtime.evidence(), lb = e.network.loadBalancers[0]!;
    expect(maxActive).toBe(1); expect(maxPending).toBeLessThanOrEqual(maxQueued);
    expect(maxRetrying).toBe(1); expect(maxBackend).toBe(1); expect(minBackoffActive).toBe(1);
    expect(backoffObserved).toBe(true); expect(lb.retries).toBeGreaterThan(0);
    expect(lb.received).toBe(16); expect(lb.attempts).toBe(lb.backends[0]!.selected);
    expect(e.counts.completed + e.counts.rejected).toBe(16);
    expect(e.network.trace.omitted).toBe(0); expect(e.resultRetention.omitted).toBe(0);
    const overflow = e.network.trace.events.filter(r => r.kind === "lb-failure" && r.detail === "pending-overflow").length;
    expect(overflow).toBe(maxQueued === 0 ? 14 : 0);
    console.info("lb-retry-admission", JSON.stringify({ maxQueued, received: lb.received, attempts: lb.attempts, retries: lb.retries, completed: lb.completed, rejected: lb.rejected, overflow }));
    const replay = burst({ ...settings, maxQueued }, "retry"); replay.runtime.advanceTo(1000000);
    expect(hash(e)).toBe(hash(replay.runtime.evidence()));
  }
});

test("admission pressure preserves breaker refusal, half-open recovery and non-retryable circuit-open outcomes", () => {
  const f = burst(settings, "breaker"), outcome = observe(f), e = f.runtime.evidence();
  const path = e.network.paths.find(p => p.source === "lb" && p.target === "app")!, breaker = path.circuitBreaker!;
  expect(outcome.maxActive).toBe(1); expect(outcome.maxPending).toBeGreaterThan(0);
  expect(breaker.transitions["closed->open"]).toBeGreaterThan(0);
  expect(breaker.rejected.open).toBeGreaterThan(0); expect(breaker.probes.succeeded).toBe(1); expect(breaker.state).toBe("closed");
  expect(e.network.loadBalancers[0]!.suppressedByReason!["non-retryable"]).toBeGreaterThan(0);
  expect(e.counts.completed + e.counts.rejected).toBe(16); expect(outcome.completed).toBeGreaterThan(0);
  console.info("lb-breaker-admission", JSON.stringify({ outcome, breaker }));
  const replay = burst(settings, "breaker"); replay.runtime.advanceTo(1000000);
  expect(hash(e)).toBe(hash(replay.runtime.evidence()));
});
