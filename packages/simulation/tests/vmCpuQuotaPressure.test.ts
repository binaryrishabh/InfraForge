import { expect, test } from "bun:test";
import { quotaPressure, quotaState, observeQuota } from "./vmCpuQuotaPressure.fixture";
import { hash } from "./keyspace.fixture";
import { prepareQuota, quotaDesign } from "./vmCpuQuota.fixture";
import { requireKnown } from "../src/reality/quantity";

test("real quota depletion, per-window conservation and boundary replenishment", () => {
  const f = quotaPressure({ percent: 25 });
  f.runtime.advanceTo(50000); const a = quotaState(f).compute!.cpu;
  expect(a.throttled).toBe(true); expect(a.appCoreUs).toBeCloseTo(25000, 6); expect(a.quotaRemainingCoreUs).toBe(0);
  f.runtime.advanceTo(99999); expect(quotaState(f).compute!.cpu.appCoreUs).toBe(a.appCoreUs);
  f.runtime.advanceTo(100000); const b = quotaState(f).compute!.cpu;
  expect(b.throttled).toBe(false); expect(b.quotaRemainingCoreUs).toBe(25000); expect(b.appCoreUs).toBe(a.appCoreUs);
  f.runtime.advanceTo(125000); expect(quotaState(f).compute!.cpu.appCoreUs).toBeCloseTo(50000, 6); expect(quotaState(f).compute!.cpu.throttled).toBe(true);
  const proof = observeQuota(quotaPressure({ percent: 25 }));
  expect(proof.maxWindowCoreUs).toBeLessThanOrEqual(25000 + 1e-6); expect(proof.completed).toBe(64);
  console.info("quota-boundary-conservation", JSON.stringify({ at50000: { used: a.appCoreUs, remaining: a.quotaRemainingCoreUs, throttled: a.throttled }, at100000: { used: b.appCoreUs, remaining: b.quotaRemainingCoreUs, throttled: b.throttled }, proof }));
});

test("lower percent increases completion time; higher percent reduces throttling on identical CPU load", () => {
  const low = observeQuota(quotaPressure({ percent: 25 })), high = observeQuota(quotaPressure({ percent: 50 }));
  expect(low.completed).toBe(64); expect(high.completed).toBe(64); expect(low.appCoreUs).toBeCloseTo(192000, 6); expect(high.appCoreUs).toBeCloseTo(low.appCoreUs, 6);
  expect(low.p95Us!).toBeGreaterThan(high.p95Us!); expect(low.throttledWallUs).toBeGreaterThan(high.throttledWallUs);
  console.info("quota-percent-comparison", JSON.stringify({ low, high }));
});

test("more workers reduce worker queue pressure while all workers still obey the same quota", () => {
  const one = observeQuota(quotaPressure({ percent: 25, workers: 1 })), many = observeQuota(quotaPressure({ percent: 25, workers: 64 }));
  expect(many.maxQueued).toBeLessThan(one.maxQueued); expect(many.queueAreaUs).toBeLessThan(one.queueAreaUs);
  for (const v of [one, many]) { expect(v.throttledWallUs).toBeGreaterThan(0); expect(v.maxWindowCoreUs).toBeLessThanOrEqual(25000 + 1e-6); expect(v.appCoreUs).toBeCloseTo(192000, 6); }
  console.info("quota-worker-comparison", JSON.stringify({ one, many }));
});

test("zero queue refuses; large queue admits waiting work without bypassing CPU quota and preserves FIFO", () => {
  const zero = observeQuota(quotaPressure({ percent: 25, workers: 1, queue: 0 })), f = quotaPressure({ percent: 25, workers: 1, queue: 1000 }), room = observeQuota(f);
  expect(zero.refused).toBeGreaterThan(0); expect(zero.maxQueued).toBe(0); expect(room.refused).toBe(0); expect(room.maxQueued).toBeGreaterThan(0);
  expect(room.completed).toBeGreaterThan(zero.completed); expect(room.maxWindowCoreUs).toBeLessThanOrEqual(25000 + 1e-6);
  expect(f.started).toEqual(f.admitted); expect(f.admitted).toHaveLength(64);
});

test("runnable CPU contention and exhausted quota have distinct real symptoms", () => {
  const unlimited = quotaPressure(), limited = quotaPressure({ percent: 25 });
  unlimited.runtime.advanceTo(10000); limited.runtime.advanceTo(50000);
  const a = quotaState(unlimited), b = quotaState(limited);
  expect(a.compute!.cpu.contended).toBe(true); expect(a.compute!.cpu.throttled).toBe(false); expect(a.compute!.symptoms).toContain("cpu-contended");
  expect(a.compute!.cpu.quotaRemainingCoreUs).toBeNull(); expect(b.compute!.cpu.throttled).toBe(true); expect(b.compute!.symptoms).toContain("cpu-throttled"); expect(b.compute!.symptoms).not.toContain("cpu-contended");
  console.info("quota-versus-contention", JSON.stringify({ contention: a.compute!.symptoms, throttle: b.compute!.symptoms }));
});

test("blocked application wait and downstream dependency hold workers without spending quota", () => {
  for (const mode of ["plain", "dependency"] as const) {
    const f = quotaPressure({ percent: 25, count: 1, ...(mode === "plain" ? { blockedWait: 200000 } : { mode }) });
    f.runtime.advanceTo(4000); const first = quotaState(f).compute!;
    f.runtime.advanceTo(4500); const next = quotaState(f).compute!;
    expect(first.workers[mode === "plain" ? "blockedWait" : "blockedDependency"]).toBe(1);
    expect(first.cpu.runnable).toBe(0); expect(next.cpu.appCoreUs).toBe(first.cpu.appCoreUs); expect(next.cpu.quotaRemainingCoreUs).toBe(first.cpu.quotaRemainingCoreUs);
  }
});

test("LB admission and retries compose with VM refusal and cannot create CPU beyond its quota", () => {
  for (const retry of [false, true]) {
    const f = quotaPressure({ percent: 25, workers: 1, queue: 0, mode: "lb", retry, count: 600, interval: 1000 }), a = observeQuota(f);
    const e = f.runtime.evidence(), lb = e.network.loadBalancers[0]!;
    expect(a.refused).toBeGreaterThan(0); expect(a.maxQueued).toBe(0); expect(a.throttledWallUs).toBeGreaterThan(0); expect(a.maxWindowCoreUs).toBeLessThanOrEqual(25000 + 1e-6);
    if (retry) expect(lb.retries).toBeGreaterThan(0);
    console.info("quota-lb-retry", JSON.stringify({ retry, ...a, retries: lb.retries, attempts: lb.attempts }));
  }
  const f = quotaPressure({ percent: 25, mode: "lb", lbActive: 1 });
  let sawPending = false;
  for (let at = 1000; at <= 1000000; at += 1000) {
    f.runtime.advanceTo(at);
    const lb = f.runtime.evidence().network.loadBalancers[0]!;
    expect(lb.active).toBeLessThanOrEqual(1); sawPending ||= lb.pending > 0;
  }
  expect(sawPending).toBe(true);
});

test("several VMs behind an LB enforce separate quota budgets", () => {
  const f = quotaPressure({ percent: 25, mode: "several", count: 128 }); observeQuota(f);
  for (const id of ["app", "other"]) {
    // Each backend also serves one real 100 core-us health probe in this interval.
    const s = quotaState(f, id); expect(s.compute!.cpu.appCoreUs).toBeCloseTo(192100, 6); expect(s.compute!.cpu.throttledWallUs).toBeGreaterThan(0);
    const g = quotaPressure({ percent: 25, mode: "several", count: 128 });
    let previous = 0;
    for (let at = 100000; at <= 1000000; at += 100000) {
      g.runtime.advanceTo(at); const used = quotaState(g, id).compute!.cpu.appCoreUs;
      expect(used - previous).toBeLessThanOrEqual(25000 + 1e-6); previous = used;
    }
  }
  expect(f.runtime.evidence().network.loadBalancers[0]!.backends.map(b => b.selected)).toEqual([64, 64]);
});

test("autoscaled replica templates preserve authored quota and serve real load", () => {
  const d = quotaDesign("autoscaled"); d.workload.targetThroughput = 260 * 60; d.workload.readWriteRatio = 1;
  d.resources.find(r => r.id === "app")!.vmCpuQuota = { version: 1, limitPercent: 75 };
  const f = prepareQuota(d), apps = f.compiled.input.resources.filter(r => r.kind === "compute");
  expect(apps).toHaveLength(3);
  for (const app of apps) {
    if (app.kind !== "compute") throw Error("Missing compute");
    expect(requireKnown(app.quota!.budget, "cpu-us")).toBe(75000); expect(requireKnown(app.quota!.period, "us")).toBe(100000);
  }
  const previous = new Map<string, number>();
  for (let at = 100000; at <= 30000000; at += 100000) {
    f.runtime.advanceTo(at);
    for (const app of apps) {
      const used = (f.runtime.inspect(app.id) as { compute: { cpu: { appCoreUs: number } } }).compute.cpu.appCoreUs;
      expect(used - (previous.get(app.id) ?? 0)).toBeLessThanOrEqual(75000 + 1e-6); previous.set(app.id, used);
    }
  }
  const e = f.runtime.evidence();
  expect(e.product.controllers[0]!.populations.ready!).toBeGreaterThan(1);
  expect(e.network.loadBalancers[0]!.backends.filter(b => b.selected > 0).length).toBeGreaterThan(1);
  for (const sample of e.samples) for (const r of sample.resources.filter(r => r.compute)) expect(r.compute!.cpu.appCoreUs).toBeLessThanOrEqual((Math.floor(sample.at / 100000) + 1) * 75000 + 1e-6);
  console.info("quota-autoscaling", JSON.stringify({ ready: e.product.controllers[0]!.populations.ready, completed: e.counts.completed }));
});

test("Application Flow respects quota, queue admission and deterministic stepped execution", () => {
  for (const mode of ["plain", "flow", "lb", "several"] as const) {
    const a = quotaPressure({ percent: 25, mode }), b = quotaPressure({ percent: 25, mode });
    const proof = observeQuota(a); b.runtime.advanceTo(1000000);
    expect(hash(a.compiled)).toBe(hash(b.compiled)); expect(hash(a.runtime.evidence())).toBe(hash(b.runtime.evidence()));
    expect(proof.throttledWallUs).toBeGreaterThan(0); expect(proof.maxWindowCoreUs).toBeLessThanOrEqual(25000 + 1e-6);
    if (mode === "flow") expect(a.runtime.evidence().applicationFlow!.events.some(e => e.kind === "flow-branch-terminal")).toBe(true);
  }
});
