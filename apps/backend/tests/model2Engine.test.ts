import { expect, test } from "bun:test";
import { productFixture } from "../../../packages/simulation/tests/productFixture";
import { ActionRefused, createModel2Engine, type ContractBuilder } from "../simulator/model2Engine";

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
function engine(seconds: number, rps = 100) {
  const fixture = (horizon: number) => { const f = productFixture({ horizon: horizon * 1_000_000 }); retune(f); return f; };
  const f = fixture(seconds);
  const workload = { ...f.design.workload, targetThroughput: rps * 60, throughputUnit: "per-minute" as const, trafficShape: "steady" as const };
  const build: ContractBuilder = (_design, horizon) => ({ contract: fixture(horizon).contract });
  return createModel2Engine({ resources: f.design.resources, connectionLines: f.design.connections, workloadProfile: workload as never }, seconds, build);
}

test("a live Model 2 run fills the live view every second, keeping unknown values unknown", () => {
  const run = engine(12);
  expect(run.view().metrics.vm).toEqual({ cpu: null, memory: null, health: "unknown" });
  const logs = Array.from({ length: 12 }, () => run.advance()).flat();
  const view = run.view();
  expect(view.simulatedSeconds).toBe(12);
  expect(view.metrics.lb!.cpu).toBeNull(); // a load balancer's CPU is not modeled
  expect(view.metrics.vm!.memory).toBeNull();
  expect(view.metrics.vm!.cpu).toBeGreaterThan(0);
  expect(view.metrics.vm!.replicas).toEqual({ ready: 1, total: 1 });
  expect(view.traffic.completedRps).toBeGreaterThan(90);
  expect(view.traffic.latencyMs.p95).toBeGreaterThan(0);
  expect(view.overallHealth).toBe("healthy");
  expect(view.pools.lb).toMatchObject({ lbId: "lb", baseVmIds: ["vm"], currentReplicas: 1, pending: null });
  expect(run.burnRatePerHourUsd()).toBeGreaterThan(0);
  expect(logs.every((l) => l.source === "model-2" && l.message.length > 0)).toBe(true);
});

test("live faults run on Model 2; what Model 2 does not model is refused plainly", () => {
  const run = engine(60);
  for (let s = 0; s < 8; s++) run.advance();
  const crash = run.apply({ kind: "chaos", parameters: { type: "crash", resourceId: "vm" } });
  expect(crash).toEqual({ outcome: { durationSimulatedSeconds: 30 }, endSecond: 38 });
  const logs = [run.advance(), run.advance()].flat();
  expect(run.view().metrics.vm!.health).toBe("failed");
  expect(run.view().overallHealth).toBe("critical");
  expect(run.view().activeChaos).toEqual([{ chaosType: "crash", resourceId: "vm", durationTicks: 30, remainingTicks: 28 }]);
  expect(logs.some((l) => l.resourceId === "vm" && l.severity === "error")).toBe(true);
  expect(() => run.apply({ kind: "chaos", parameters: { type: "memory-leak", resourceId: "vm" } })).toThrow(ActionRefused);
  expect(() => run.apply({ kind: "chaos", parameters: { type: "crash", resourceId: "lb" } })).toThrow("Model 2 cannot apply this here");
  expect(() => run.apply({ kind: "vertical-scale", parameters: { resourceId: "vm", skuId: "x" } })).toThrow("Resizing during a Model 2 run");
  expect(() => run.apply({ kind: "topology", parameters: { resources: [], connectionLines: [], expectedRevision: 0 } })).toThrow("Changing the design");
  expect(run.actions.map((a) => a.kind)).toEqual(["crash"]); // refusals leave the run unchanged
});

test("load and replica changes apply from the next second", () => {
  const run = engine(30);
  for (let s = 0; s < 6; s++) run.advance();
  expect(run.apply({ kind: "load", parameters: { targetLoadFraction: 2 } }).outcome).toEqual({ previousTarget: 1, appliedTarget: 2 });
  run.advance(); run.advance();
  expect(run.view().traffic.offeredRps).toBeGreaterThanOrEqual(199);
  expect(run.view().targetLoadFraction).toBe(2);
  expect(run.apply({ kind: "pool-scale", parameters: { lbId: "lb", delta: 1 } }).outcome).toEqual({ delta: 1, previousReplicaCount: 1 });
  let settled: number | null = null;
  for (let s = 0; s < 5 && settled === null; s++) { run.advance(); settled = run.poolSettled("lb", 1, 1); }
  expect(settled).toBe(2);
  expect(run.view().pools.lb!.currentReplicas).toBe(2);
  expect(() => run.apply({ kind: "pool-scale", parameters: { lbId: "db", delta: 1 } })).toThrow("no adjustable replica pool");
});
