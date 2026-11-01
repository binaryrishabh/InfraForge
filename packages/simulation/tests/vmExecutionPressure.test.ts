import { expect, test } from "bun:test";
import { pressure, observePressure, workloadAt } from "./vmExecutionPressure.fixture";
import { hash } from "./keyspace.fixture";
import { vmDesign, prepareVm } from "./vmExecution.fixture";

test("proofs 2,3,6,7: extra workers increase concurrency and reduce real FIFO waiting and response time", () => {
  const low = pressure(1), high = pressure(8), a = observePressure(low), b = observePressure(high);
  expect(a.maxActive).toBe(1); expect(b.maxActive).toBe(8); expect(b.maxRunnable).toBe(8);
  expect(a.maxQueued).toBeGreaterThan(0); expect(b.maxQueued).toBe(0); expect(a.maxBackpressure).toBe(true);
  expect(a.completed).toBe(256); expect(b.completed).toBe(256); expect(a.rejected + b.rejected).toBe(0);
  expect(a.p95Us!).toBeGreaterThan(b.p95Us!); expect(a.sampledQueueUs).toBeGreaterThan(b.sampledQueueUs);
  expect(low.started).toEqual(low.admitted); expect(low.admitted).toHaveLength(256);
  console.info("vm-worker-comparison", JSON.stringify({ low: a, high: b }));
});

test("proofs 4,5: zero queue refuses busy arrivals while a larger queue admits real waiting work", () => {
  const a = observePressure(pressure(1, 0)), b = observePressure(pressure(1, 32));
  expect(a.maxActive).toBe(1); expect(a.maxQueued).toBe(0); expect(a.vmRefusals).toBeGreaterThan(0);
  expect(b.maxQueued).toBeGreaterThan(0); expect(b.vmRefusals).toBe(0);
  expect(b.admitted).toBeGreaterThan(a.admitted); expect(b.completed).toBeGreaterThan(a.completed);
  expect(a.completed + a.rejected).toBe(256); expect(b.completed + b.rejected).toBe(256);
  console.info("vm-queue-comparison", JSON.stringify({ zero: a, room: b }));
});

test("proof 7: workers lift a worker availability bottleneck under identical sustained offered load", () => {
  const offered = { perBurst: 1, bursts: 600, gapUs: 1666 };
  const a = observePressure(pressure(1, 1000, offered)), b = observePressure(pressure(4, 1000, offered));
  expect(a.completed).toBeLessThan(b.completed); expect(a.maxQueued).toBeGreaterThan(b.maxQueued);
  expect(b.completed).toBeGreaterThan(590); expect(a.vmRefusals + b.vmRefusals).toBe(0);
  console.info("vm-worker-throughput", JSON.stringify({ one: a, four: b }));
});

test("proof 8: four runnable workers share one core and cannot create CPU capacity", () => {
  const offered = { cores: 1, perBurst: 1, bursts: 600, gapUs: 1666 };
  const a = observePressure(pressure(1, 1000, offered)), b = observePressure(pressure(4, 1000, offered));
  expect(b.maxRunnable).toBe(4); expect(b.maxAllocatedCores).toBeLessThanOrEqual(1);
  expect(b.appCoreUs).toBeLessThanOrEqual(b.availableCoreUs); expect(b.availableCoreUs).toBe(1000000);
  expect(b.completed).toBeLessThanOrEqual(Math.floor(b.availableCoreUs / 3000));
  expect(Math.abs(a.completed - b.completed)).toBeLessThanOrEqual(4);
  expect(b.unsatisfiedParallelismUs).toBeGreaterThan(a.unsatisfiedParallelismUs); expect(b.maxQueued).toBeLessThan(a.maxQueued);
  console.info("vm-one-core-contention", JSON.stringify({ one: a, four: b }));
});

test("proof 9: blocked downstream requests still occupy workers and backpressure the VM", () => {
  const a = observePressure(pressure(1, 256, { mode: "downstream" })), b = observePressure(pressure(8, 256, { mode: "downstream" }));
  expect(a.maxBlocked).toBe(1); expect(a.maxActive).toBe(1); expect(a.maxQueued).toBeGreaterThan(0);
  expect(b.maxBlocked).toBeGreaterThan(1); expect(b.maxActive).toBeLessThanOrEqual(8); expect(b.completed).toBeGreaterThan(a.completed);
  expect(b.sampledQueueUs).toBeLessThan(a.sampledQueueUs);
  console.info("vm-blocked-dependency", JSON.stringify({ one: a, eight: b }));
});

test("proof 10: Application Flow uses the same worker and queue admission gates", () => {
  const low = pressure(1, 256, { mode: "flow" }), high = pressure(8, 256, { mode: "flow" }), a = observePressure(low), b = observePressure(high);
  expect(a.maxActive).toBe(1); expect(a.maxBlocked).toBe(1); expect(a.maxQueued).toBeGreaterThan(0);
  expect(b.maxActive).toBeLessThanOrEqual(8); expect(b.maxBlocked).toBeGreaterThan(1); expect(b.completed).toBeGreaterThan(a.completed);
  expect(high.runtime.evidence().applicationFlow!.events.some(e => e.kind === "flow-branch-terminal")).toBe(true);
  const zero = observePressure(pressure(1, 0, { mode: "flow" })); expect(zero.vmRefusals).toBeGreaterThan(0); expect(zero.maxQueued).toBe(0);
  console.info("vm-flow-admission", JSON.stringify({ one: a, eight: b, zero }));
});

for (const queuedRequests of [0, 2]) test(`proof 11: LB admission cannot exceed VM worker/queue limits, queue=${queuedRequests}`, () => {
  const f = pressure(1, queuedRequests, { mode: "lb" }), a = observePressure(f), lb = f.runtime.evidence().network.loadBalancers[0]!;
  expect(a.maxActive).toBe(1); expect(a.maxQueued).toBeLessThanOrEqual(queuedRequests); expect(a.vmRefusals).toBeGreaterThan(0);
  expect(lb.attempts).toBe(256); expect(lb.pending).toBe(0); expect(a.completed + a.rejected).toBe(256);
  const failure = f.runtime.evidence().network.trace.events.filter(e => e.kind === "lb-failure");
  expect(failure.some(e => e.detail === "pending-overflow" || e.detail === "pending-timeout")).toBe(false);
  if (queuedRequests > 0) expect(a.maxQueued).toBe(queuedRequests);
  console.info("vm-behind-lb-capacity", JSON.stringify({ queuedRequests, ...a }));
});

test("proof 12: LB retries reach the same VM gates and cannot bypass full capacity", () => {
  const without = pressure(1, 0, { mode: "lb" }), withRetry = pressure(1, 0, { mode: "lb", retry: true });
  const a = observePressure(without), b = observePressure(withRetry), e = withRetry.runtime.evidence(), lb = e.network.loadBalancers[0]!;
  expect(lb.retries).toBeGreaterThan(0); expect(lb.attempts).toBeGreaterThan(256); expect(b.vmRefusals).toBeGreaterThan(0);
  expect(b.maxActive).toBe(1); expect(b.maxQueued).toBe(0); expect(b.completed + b.rejected).toBe(256);
  console.info("vm-retry-capacity", JSON.stringify({ without: a, retry: b, retries: lb.retries, attempts: lb.attempts }));
});

test("proof 13: several VMs receive consistent round-robin work within their own limits", () => {
  const f = pressure(1, 32, { mode: "several" });
  const a = observePressure(f), e = f.runtime.evidence(), lb = e.network.loadBalancers[0]!;
  expect(a.maxActive).toBe(1); expect(a.maxQueued).toBeGreaterThan(0); expect(e.counts.completed).toBe(256);
  expect(lb.backends.map(b => b.selected)).toEqual([128, 128]);
  for (const id of ["app", "other"]) {
    const rows = e.samples.flatMap(s => s.resources.filter(r => r.id === id));
    expect(rows.every(r => r.queued <= 32 && r.serving + r.waiting <= 1)).toBe(true);
    expect((f.runtime.inspect(id) as { rejected: number }).rejected).toBe(0);
  }
  const replay = pressure(1, 32, { mode: "several" }); replay.runtime.advanceTo(1000000);
  expect(hash(replay.runtime.evidence())).toBe(hash(e));
});

test("proof 14: explicit default limits preserve real autoscaling decisions and serving evidence", () => {
  const d = workloadAt(vmDesign("autoscaled"), 600), old = prepareVm(d);
  d.resources.find(r => r.id === "app")!.vmExecution = { version: 1, workers: 4, queuedRequests: 256 };
  const explicit = prepareVm(d);
  old.runtime.advanceTo(30000000); explicit.runtime.advanceTo(30000000);
  const a = old.runtime.evidence(), b = explicit.runtime.evidence();
  expect(b.product.controllers).toEqual(a.product.controllers); expect(b.samples).toEqual(a.samples); expect(b.counts).toEqual(a.counts);
  expect(b.product.controllers[0]!.populations.ready!).toBeGreaterThan(1); expect(b.product.controllers[0]!.populations.ready!).toBeLessThanOrEqual(3); expect(b.product.controllers[0]!.events.some(e => e.kind === "desired")).toBe(true);
  expect(b.network.loadBalancers[0]!.backends.filter(b => b.selected > 0)).toHaveLength(b.product.controllers[0]!.inService);
  console.info("vm-autoscaling-defaults", JSON.stringify({ ready: b.product.controllers[0]!.populations.ready, completed: b.counts.completed }));
});

test("proof 15: one-shot and stepped execution have identical compiled and complete evidence hashes", () => {
  for (const options of [{}, { cores: 1 }, { mode: "flow" as const }, { mode: "lb" as const, retry: true }]) {
    const a = pressure(4, 2, options), b = pressure(4, 2, options); observePressure(a); b.runtime.advanceTo(1000000);
    expect(hash(a.compiled)).toBe(hash(b.compiled)); expect(hash(a.runtime.evidence())).toBe(hash(b.runtime.evidence()));
  }
});
