import { expect, test } from "bun:test";
import { productFixture } from "./productFixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createActionableLiveModel2, createLiveModel2 } from "../src/model2/product/live";
import { withTimeline } from "../src/model2/product/timeline";
import { createProductModel2 } from "../src/model2/product/run";

// The fixture's authored intervals are microseconds; live runs use realistic ones.
const realistic: Record<string, number> = { "lb.health.interval": 5_000_000, "monitor.interval": 10_000_000, "run.sample": 1_000_000,
  "controller.interval": 15_000_000, "controller.cooldown": 60_000_000, "controller.stabilization": 300_000_000 };
function retune(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (o.kind === "known" && Array.isArray(o.provenance) && typeof o.provenance[0] === "string" && o.provenance[0] in realistic) o.value = realistic[o.provenance[0]];
  if (typeof o.id === "string" && o.id in realistic && o.quantity && typeof o.quantity === "object") { (o.quantity as Record<string, unknown>).value = realistic[o.id]; o.formula = String(realistic[o.id]); }
  for (const value of Object.values(o)) retune(value);
}
function fixture(seconds: number, rps: number) {
  const f = productFixture({ horizon: seconds * 1_000_000 }); retune(f);
  f.design.workload = { ...f.design.workload, targetThroughput: rps * 60, throughputUnit: "per-minute", trafficShape: "steady" };
  return f;
}
function live(seconds: number, rps: number) {
  const f = fixture(seconds, rps);
  const compiled = compileProduct(f.design, f.contract);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return { run: createLiveModel2(compiled.value, f.design.resources.map((r) => r.id)), nodes: f.design.resources.map((r) => r.id), compiled: compiled.value };
}

test("each simulated second projects every drawn node, with Unknown kept as null", () => {
  const { run, nodes } = live(12, 50);
  const seconds = [];
  for (let s = 0; s < 12; s++) { run.advanceSecond(); seconds.push(run.project()); }
  const last = seconds.at(-1)!;
  expect(last.simulatedSeconds).toBe(12);
  expect(Object.keys(last.metrics).sort()).toEqual([...nodes].sort());
  for (const m of Object.values(last.metrics)) {
    for (const v of [m.cpu, m.memory, m.connections, m.rps, m.errorRate]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
    if (m.cpu !== null) { expect(m.cpu).toBeGreaterThanOrEqual(0); expect(m.cpu).toBeLessThanOrEqual(100); }
    expect(m.memory).toBeNull(); // resident memory is not modeled for these profiles: Unknown, not 0
  }
  // Steady load reaches the application tier and the load balancer once backends are healthy.
  const steady = seconds.slice(6);
  expect(steady.reduce((n, s) => n + s.completedRps, 0)).toBeGreaterThan(0);
  expect(steady.some((s) => (s.metrics.vm!.rps ?? 0) > 0)).toBe(true);
  expect(steady.some((s) => (s.metrics.lb!.rps ?? 0) > 0)).toBe(true);
  expect(last.metrics.vm!.replicas!.ready).toBeGreaterThan(0);
  expect(steady.every((s) => s.completedRps === 0 ? s.latencyMs.p50 === null : s.latencyMs.p50! > 0 && s.latencyMs.p95! >= s.latencyMs.p50!)).toBe(true);
});

test("per-second totals add up to the same run's full evidence", () => {
  const { run, compiled, nodes } = live(10, 120);
  const seconds = Array.from({ length: 10 }, () => { run.advanceSecond(); return run.project(); });
  const full = createProductModel2(compiled); full.advanceTo(10_000_000);
  const e = full.evidence(), sum = (key: "offeredRps" | "completedRps" | "failedRps") => seconds.reduce((n, s) => n + s[key], 0);
  expect(sum("offeredRps")).toBe(e.counts.offered);
  expect(sum("completedRps")).toBe(e.counts.completed);
  expect(sum("failedRps")).toBe(e.counts.rejected + e.counts.deadlineExceeded + e.counts.abandoned);
  // The application tier's per-second throughput adds up to its own station counters.
  const vm = e.samples.at(-1)!.resources.filter((r: { id: string }) => r.id === "vm" || r.id.startsWith("vm#") && !r.id.includes("/"));
  expect(seconds.reduce((n, s) => n + (s.metrics.vm!.rps ?? 0), 0)).toBe(vm.reduce((n: number, r: { completed: number }) => n + r.completed, 0));
  expect(nodes).toContain("vm");
});

test("the same run projects exactly the same seconds again", () => {
  const a = live(6, 80), b = live(6, 80);
  for (let s = 0; s < 6; s++) { a.run.advanceSecond(); b.run.advanceSecond(); expect(a.run.project()).toEqual(b.run.project()); }
});

test("a run cannot be advanced past its horizon", () => {
  const { run } = live(2, 10);
  run.advanceSecond(); run.advanceSecond();
  expect(() => run.advanceSecond()).toThrow("horizon");
});

test("an action rebuilds the run without changing any second before it", () => {
  const f = fixture(20, 100), nodes = f.design.resources.map((r) => r.id);
  const crash = { id: "crash-1", kind: "crash" as const, node: "vm", durationUs: 4_000_000, restartUs: 1_000_000 };
  const compiled = (contract: typeof f.contract) => { const c = compileProduct(f.design, contract); if (!c.ok) throw new Error("refused"); return c.value; };
  const plain = createLiveModel2(compiled(f.contract), nodes);
  const scratch = createLiveModel2(compiled(withTimeline(f.contract, [{ ...crash, atUs: 10_000_001 }])), nodes);
  const acting = createActionableLiveModel2(f.design, f.contract, nodes);
  const seconds = (run: { advanceSecond(): void; project(): unknown }, n: number) => Array.from({ length: n }, () => { run.advanceSecond(); return run.project(); });
  const before = seconds(acting, 10);
  acting.apply(crash);
  expect(acting.catchingUp).toBe(true);
  expect(() => acting.advanceSecond()).toThrow("catching up");
  let steps = 0;
  while (!acting.catchUp(3)) steps++;
  expect(steps).toBe(3); // 10 seconds in steps of 3: 3, 6, 9, then 10
  expect(acting.simulatedSeconds).toBe(10);
  const after = seconds(acting, 10), fromScratch = seconds(scratch, 20);
  expect(fromScratch.slice(0, 10)).toEqual(seconds(plain, 10)); // a later action never reaches back in time
  expect(fromScratch.slice(0, 10)).toEqual(before);
  expect(after).toEqual(fromScratch.slice(10)); // rebuild + fast-forward equals a run that always had the action
  const health = (s: unknown) => (s as { metrics: Record<string, { health: string }> }).metrics;
  expect(after.slice(0, 3).every((s) => health(s).vm!.health === "failed" && health(s).lb!.health === "failed")).toBe(true);
  expect(health(after.at(-1)).vm!.health).toBe("healthy"); // restarted after 4 s down plus 1 s restart
  expect(acting.actions).toEqual([{ ...crash, atUs: 10_000_001 }]);
});

test("load and replica actions take effect from their second on; a refused action changes nothing", () => {
  const f = fixture(16, 100), acting = createActionableLiveModel2(f.design, f.contract, f.design.resources.map((r) => r.id));
  for (let s = 0; s < 6; s++) acting.advanceSecond();
  acting.project();
  acting.apply({ id: "pause", kind: "load", fraction: 0 });
  acting.catchUp(100);
  acting.advanceSecond(); acting.advanceSecond(); acting.project();
  acting.advanceSecond();
  expect(acting.project().offeredRps).toBe(0);
  acting.apply({ id: "double", kind: "load", fraction: 2 });
  acting.apply({ id: "grow", kind: "replicas", node: "vm", desired: 3 });
  acting.catchUp(100);
  acting.advanceSecond();
  expect(acting.project().metrics.vm!.replicas!.total).toBe(3); // the fixture's fast autoscaler may later scale an idle pool back in
  acting.advanceSecond();
  expect(acting.project().offeredRps).toBeGreaterThanOrEqual(199);
  expect(() => acting.apply({ id: "bad", kind: "replicas", node: "db", desired: 2 })).toThrow("no replica pool");
  expect(acting.actions.map((a) => a.id)).toEqual(["pause", "double", "grow"]);
  acting.advanceSecond();
  expect(acting.project().simulatedSeconds).toBe(12);
});

test("generated arrivals run exactly like the stored trace, without storing it", () => {
  const f = fixture(12, 150), nodes = f.design.resources.map((r) => r.id);
  const pause = [{ id: "pause", kind: "load" as const, fraction: 0, atUs: 4_000_001 }, { id: "resume", kind: "load" as const, fraction: 1.5, atUs: 7_000_001 }];
  const stored = compileProduct(f.design, withTimeline(f.contract, pause));
  const generated = compileProduct(f.design, withTimeline({ ...f.contract, arrival: { ...f.contract.arrival, generated: true } }, pause));
  if (!stored.ok || !generated.ok) throw new Error("refused");
  expect(generated.value.input.arrivals[0]!.kind).toBe("rate");
  expect(JSON.stringify(generated.value.input.arrivals).length).toBeLessThan(1_000); // a rate, not ~1,600 stored rows
  expect(JSON.stringify(stored.value.input.arrivals).length).toBeGreaterThan(50_000);
  const a = createLiveModel2(stored.value, nodes), b = createLiveModel2(generated.value, nodes);
  const seconds = Array.from({ length: 12 }, () => { a.advanceSecond(); b.advanceSecond(); return [a.project(), b.project()] as const; });
  for (const [x, y] of seconds) expect(y).toEqual(x);
  expect(seconds.slice(5, 7).every(([x]) => x.offeredRps === 0)).toBe(true);
  expect(seconds[9]![0].offeredRps).toBeGreaterThanOrEqual(224);
});

test("a peak window can repeat, like a 2-second burst every 6 seconds", () => {
  const f = fixture(14, 100), nodes = f.design.resources.map((r) => r.id);
  f.design.workload = { ...f.design.workload, trafficShape: "peak", peakMultiplier: 2 };
  const us = (value: number) => ({ kind: "known" as const, value, unit: "us" as const, provenance: ["test-peak"] });
  f.contract.arrival = { ...f.contract.arrival, generated: true, peak: { start: us(4_000_000), end: us(6_000_000), every: us(6_000_000) } };
  const compiled = compileProduct(f.design, f.contract);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const run = createLiveModel2(compiled.value, nodes);
  const offered = Array.from({ length: 14 }, () => { run.advanceSecond(); return run.project().offeredRps; });
  // Seconds 5-6 and 11-12 carry the bursts (arrivals in [4,6) and [10,12)); the others carry the base rate.
  for (const s of [5, 6, 11, 12]) expect(offered[s - 1]).toBeGreaterThanOrEqual(198);
  for (const s of [3, 4, 8, 9, 14]) expect(offered[s - 1]).toBeLessThanOrEqual(102);
});

test("a crashed cache shows failed; cache misses and refused stale fills are not errors", () => {
  const f = fixture(16, 100), nodes = f.design.resources.map((r) => r.id);
  const crash = { id: "c1", kind: "crash" as const, node: "cache", durationUs: 4_000_000, restartUs: 1_000_000, atUs: 8_000_001 };
  const compiled = compileProduct(f.design, withTimeline(f.contract, [crash]));
  if (!compiled.ok) throw new Error("refused");
  const run = createLiveModel2(compiled.value, nodes);
  const seconds = Array.from({ length: 16 }, () => { run.advanceSecond(); return run.project(); });
  expect(seconds.slice(0, 8).every((s) => s.metrics.cache!.health === "healthy")).toBe(true);
  expect(seconds.slice(9, 12).every((s) => s.metrics.cache!.health === "failed")).toBe(true);
  expect(seconds[15]!.metrics.cache!.health).toBe("healthy");
});


test("versioned same-second actions replay the normalized timeline, exact quantities and all evidence", () => {
  const f = fixture(8, 50), nodes = f.design.resources.map(r => r.id);
  const a = createActionableLiveModel2(f.design, f.contract, nodes);
  a.advanceSecond(); a.advanceSecond();
  const request = {interventionId: "cpu-capacity", revision: 1, target: {resourceId: "db"}, parameters: {cores: 0, duration: 1}};
  a.apply({id: "first", kind: "intervention", request});
  a.apply({id: "second", kind: "load", fraction: 0.5});
  const c = compileProduct(f.design, withTimeline(f.contract, [...a.actions]));
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const b = createLiveModel2(c.value, nodes); b.catchUp(2, 2); a.catchUp(2);
  for (let second = 2; second < 8; second++) { a.advanceSecond(); b.advanceSecond(); expect(a.project()).toEqual(b.project()); }
  expect(a.actions.map(a => a.id)).toEqual(["first", "second"]);
  expect(a.evidence()).toEqual(b.evidence());
  const q = c.value.input.dataInterventions.find(i => i.kind === "cpu-capacity")!;
  expect(q.at).toMatchObject({value: 2_000_001, unit: "us"});
  expect("duration" in q && q.duration).toMatchObject({value: 1_000_000, unit: "us"});
});
