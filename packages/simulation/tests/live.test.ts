import { expect, test } from "bun:test";
import { productFixture } from "./productFixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createLiveModel2 } from "../src/model2/product/live";
import { createProductModel2 } from "../src/model2/product/run";

// The fixture's authored intervals are microseconds; live runs use realistic ones.
const realistic: Record<string, number> = { "lb.health.interval": 5_000_000, "monitor.interval": 10_000_000, "run.sample": 1_000_000 };
function retune(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (o.kind === "known" && Array.isArray(o.provenance) && typeof o.provenance[0] === "string" && o.provenance[0] in realistic) o.value = realistic[o.provenance[0]];
  if (typeof o.id === "string" && o.id in realistic && o.quantity && typeof o.quantity === "object") { (o.quantity as Record<string, unknown>).value = realistic[o.id]; o.formula = String(realistic[o.id]); }
  for (const value of Object.values(o)) retune(value);
}
function live(seconds: number, rps: number) {
  const f = productFixture({ horizon: seconds * 1_000_000 }); retune(f);
  f.design.workload = { ...f.design.workload, targetThroughput: rps * 60, throughputUnit: "per-minute" };
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
