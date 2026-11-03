import { expect, test } from "bun:test";
import { multiLbDesign, prepareMultiLb } from "./multiLb.fixture";
import { hash } from "./keyspace.fixture";
import { validateModel2Readiness } from "../src/model2/product/readiness";

for (const branches of [1, 2, 5]) test(`single caller -> entry LB -> application VM -> ${branches} downstream LBs uses actual nested paths`, () => {
  const d = multiLbDesign(branches, true);
  d.workload.targetThroughput = 1200;
  if (branches === 1) {
    const vm = { ...structuredClone(d.resources.find(r => r.id === "vm-0")!), id: "extra", vmExecution: { version: 1 as const, workers: 24 }, vmCpuQuota: { version: 1 as const, limitPercent: 60 } };
    d.resources.push(vm); d.connections.push({ ...d.connections.find(e => e.id === "backend-0")!, id: "extra-backend", targetId: vm.id });
  }
  expect(validateModel2Readiness(d.resources, d.connections, { workload: d.workload })).toMatchObject({ valid: true });
  const f = prepareMultiLb(d); f.runtime.advanceTo(f.runtime.horizon);
  const e = f.runtime.evidence();
  expect(f.compiled.input.limits.maxEvents).toBeLessThanOrEqual(10000000);
  expect(f.compiled.input.arrivals).toHaveLength(1);
  expect(f.compiled.input.paths.filter(p => p.source === "$caller").map(p => p.target)).toEqual(["entry"]);
  expect(new Set(f.compiled.input.operations.map(o => o.entry))).toEqual(new Set(["entry"]));
  expect(e.counts.offered).toBe(60); expect(e.counts.completed).toBeGreaterThan(50);
  expect(e.counts.offered).toBe(e.counts.completed + e.counts.rejected + e.counts.deadlineExceeded + e.counts.abandoned + e.counts.inFlight);
  expect(e.resultRetention.omitted).toBe(0); expect(e.network.trace.omitted).toBe(0);
  expect(e.applicationFlow!.omitted).toBe(0);
  expect(e.network.loadBalancers).toHaveLength(branches + 1);
  for (const lb of e.network.loadBalancers) {
    expect(lb.received).toBe(60); expect(lb.accounting!.rejectedAtLb).toBe(0);
    expect(lb.accounting!.acceptedByBackend).toBe(60);
    const material = f.compiled.input.resources.find(r => r.id === lb.id)!;
    if (material.kind !== "load-balancer") throw Error("LB required");
    expect(material.policy).toBe(d.resources.find(r => r.id === lb.id)!.lbSelection!.policy);
    expect(lb.backends.every(b => b.selected > 0)).toBe(true);
  }
  const delivered = e.network.trace.events.filter(r => r.kind === "request-delivered" && r.root && !r.root.startsWith('["health"'));
  for (let i = 0; i < branches; i++) {
    const path = e.network.paths.find(p => p.source === "front" && p.target === `lb-${i}`)!;
    expect(path.completed).toBeGreaterThan(50);
    expect(delivered.some(r => r.detail === `lb-${i}`)).toBe(true);
    const calls = e.applicationFlow!.events.filter(r => r.kind === "flow-branch-start" && r.detail.target === `lb-${i}`);
    expect(calls).toHaveLength(60);
  }
  const replay = prepareMultiLb(d); replay.runtime.advanceTo(replay.runtime.horizon);
  expect(hash(replay.runtime.evidence())).toBe(hash(e));
  console.info("multi-lb-single-entry", JSON.stringify({ lbs: branches + 1, roots: e.counts, perLb: e.network.loadBalancers.map(lb => ({ id: lb.id, received: lb.received, accounting: lb.accounting })), paths: e.network.paths.map(p => ({ source: p.source, target: p.target, completed: p.completed })) }));
});

test("changing one downstream admission gate leaves the other LB capacities and traffic intact", () => {
  const d = multiLbDesign(2, true), vm = d.resources.find(r => r.id === "vm-0")!;
  vm.size = "small"; vm.vmCpuQuota = { version: 1, limitPercent: 1 };
  const run = (maxActive: number) => {
    const next = structuredClone(d); next.resources.find(r => r.id === "lb-0")!.lbAdmission!.maxActive = maxActive;
    const f = prepareMultiLb(next); f.runtime.advanceTo(f.runtime.horizon); return f.runtime.evidence();
  };
  const low = run(1), high = run(8), lb = (e: typeof low, id: string) => e.network.loadBalancers.find(r => r.id === id)!;
  expect(low.counts.offered).toBe(high.counts.offered);
  expect(lb(low, "lb-0").accounting!.queuedAtLb).toBeGreaterThan(lb(high, "lb-0").accounting!.queuedAtLb);
  expect(lb(low, "lb-1").accounting).toEqual(lb(high, "lb-1").accounting);
  expect(lb(low, "entry").accounting!.rejectedAtLb).toBe(0);
});
