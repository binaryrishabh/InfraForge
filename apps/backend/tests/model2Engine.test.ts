import { expect, test } from "bun:test";
import { DeploymentChaosNames, ResourceHealth, type Resource } from "@infraforge/domain/resource";
import { resolveWorkload } from "@infraforge/domain/workload";
import { ActionRefused, createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { captureRunInputs } from "../deployments/runInputs";
import { legacyDefinition as definition } from "./challengeHarness";
import { CHALLENGE_VERSIONS } from "../challenges/definitions";
import { findChallenge } from "../challenges/registry";
import { advanceTickBatch, replayDue } from "../simulator/tickBatch";
import { buildSnapshot, captureSnapshot } from "../simulator/snapshot";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import { createEvidenceBuffer } from "../evidence/capture";
import { readRecords } from "../reports/records";
import { storedJson } from "../utils/json";
import { ActionExecutionError, type SimulationInstance } from "../simulator/instance";

// A small real canvas: DNS, a load balancer with an autoscaled app server pool, and a database.
const at = (id: string, type: string, x: number, extra: Partial<Resource> = {}): Resource => ({ id, type: type as Resource["type"], x, y: 0, ...extra });
const line = (sourceId: string, targetId: string) => ({ id: `${sourceId}-${targetId}`, sourceId, targetId, sourceType: "", targetType: "", port: 443 });
function topology() {
  return { resources: [at("dns", "DNS", 0), at("lb", "Load Balancer", 1, { autoscaling: { enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 60 } }),
    at("vm", "Virtual Machine", 2), at("db", "Database", 3)], connectionLines: [line("dns", "lb"), line("lb", "vm"), line("vm", "db")] };
}
function engine(seconds: number, rps = 100) {
  const workloadProfile = resolveWorkload({ targetThroughput: rps * 60, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" });
  return createModel2Engine({ ...topology(), workloadProfile, seed: "test-seed" }, seconds, buildModel2Contract);
}

test("a live Model 2 run fills the live view every second, keeping unknown values unknown", () => {
  const run = engine(12);
  expect(run.view().metrics.vm).toEqual({ cpu: null, memory: null, health: ResourceHealth.UNKNOWN });
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
  const crash = run.apply({ kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "vm" } });
  expect(crash).toEqual({ outcome: { durationSimulatedSeconds: 30 }, endSecond: 38 });
  const logs = [run.advance(), run.advance()].flat();
  expect(run.view().metrics.vm!.health).toBe(ResourceHealth.FAILED);
  expect(run.view().overallHealth).toBe("critical");
  expect(run.view().activeChaos).toEqual([{ chaosType: DeploymentChaosNames.Crash, resourceId: "vm", durationTicks: 30, remainingTicks: 28 }]);
  expect(logs.some((l) => l.resourceId === "vm" && l.severity === "error")).toBe(true);
  expect(() => run.apply({ kind: "chaos", parameters: { type: DeploymentChaosNames.MemoryLeak, resourceId: "vm" } })).toThrow(ActionRefused);
  expect(() => run.apply({ kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "lb" } })).toThrow("Model 2 cannot apply this here");
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

test("the run loop drives a Model 2 run: ticks, snapshots, actions and version 2 evidence", async () => {
  const plan = { version: 1 as const, fault: DeploymentChaosNames.Crash, atSimulatedSecond: 40, durationSimulatedSeconds: 30, targetResourceId: "vm", targetType: "Virtual Machine" };
  const instance: SimulationInstance = { model2: engine(90), tickCount: 0, pendingLogs: [], speed: 5, lastCheckpointAt: 0, accumulatedCostUsd: 0,
    topology: topology(), topologyRevision: 0, actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0,
    autoStopAtSimulatedSeconds: 90, evidence: createEvidenceBuffer(plan as never, 70) };
  for (let i = 0; i < 2; i++) await advanceTickBatch(instance, async () => {});
  const snapshot = buildSnapshot("m2", instance);
  expect(snapshot.simulatedSeconds).toBe(10);
  expect(snapshot.metrics.lb!.cpu).toBeNull();
  expect(snapshot.traffic!.completedRps).toBeGreaterThan(90);
  expect(snapshot.accumulatedCostUsd).toBeGreaterThan(0);
  expect(applyAction(instance, "crash-1", { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "vm" } }).status).toBe("running");
  expect(() => applyAction(instance, "leak-1", { kind: "chaos", parameters: { type: DeploymentChaosNames.MemoryLeak, resourceId: "vm" } })).toThrow(ActionExecutionError);
  expect(applyAction(instance, "speed-1", { kind: "speed", parameters: { speed: 10 } })).toEqual({ status: "completed", outcome: { previousSpeed: 5, appliedSpeed: 10 } });
  await advanceTickBatch(instance, async () => {}); await advanceTickBatch(instance, async () => {});
  expect(actionCompletion(instance, instance.actions.get("crash-1")!)).toBeNull(); // 20 of 30 seconds
  await advanceTickBatch(instance, async () => {}); await advanceTickBatch(instance, async () => {});
  expect(actionCompletion(instance, instance.actions.get("crash-1")!)).toMatchObject({ status: "completed", outcome: { faultEnded: true } });
  // Seconds 10..50 lie inside the experiment window (40-30 .. 70): each retained sample is version 2 and keeps unknown values null.
  const samples = instance.evidence!.pending;
  expect(samples.map((p) => p.simulatedSeconds)).toEqual(Array.from({ length: 41 }, (_, i) => i + 10));
  expect(samples.every((p) => p.payload.version === 2 && p.payload.resources.find((r) => r.id === "lb")!.cpu === null)).toBe(true);
  const terminal = captureSnapshot("m2", instance, "terminal");
  expect(terminal).toMatchObject({ kind: "terminal", simulatedSeconds: 50, targetLoadFraction: 1, verticalScaling: [] });
  // Reports read the Model 2 terminal record; an unknown value is simply not recorded.
  const limits: string[] = [];
  const report = readRecords({ stages: [], timeline: [], chaosEvents: [], runInputs: null, liveTopology: null, workloadProfile: null,
    simulationState: null, terminalSnapshot: storedJson(terminal) }, limits).terminal!;
  expect(limits).toEqual([]);
  expect(report.resources.find((r) => r.id === "lb")).not.toHaveProperty("cpu");
  expect(report.resources.find((r) => r.id === "vm")!.cpu).toBeGreaterThan(0);
  expect(report.health).toBe(terminal.overallHealth);
});

test("a challenge's starting design runs on Model 2 through the design adapter, for the run's own length and seed", () => {
  const def = definition("lose-an-app-server");
  const input = captureRunInputs({ ...def.starter!, layoutVersion: 3 }, def.workload, "seed-a");
  const run = createModel2Engine(input, 40, buildModel2Contract);
  expect(run.horizonSeconds).toBe(40);
  for (let s = 0; s < 20; s++) run.advance();
  const view = run.view();
  expect(view.traffic.completedRps).toBeGreaterThan(100); // 468,000 requests an hour is 130 a second
  expect(view.metrics["app-1"]!.cpu).toBeGreaterThan(0);
  expect(view.metrics.lb!.cpu).toBeNull();
  expect(() => createModel2Engine({ ...input, resources: [], connectionLines: [] }, 40, buildModel2Contract)).toThrow(ActionRefused);
});


test("a replay batch stops at each submitted action's second so it is applied exactly there", async () => {
  const instance: SimulationInstance = { model2: engine(60), tickCount: 0, pendingLogs: [], speed: 3600, lastCheckpointAt: 0, accumulatedCostUsd: 0,
    topology: topology(), topologyRevision: 0, actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0,
    autoStopAtSimulatedSeconds: 30, replay: { actions: [{ atSecond: 7, request: { kind: "load", parameters: { targetLoadFraction: 2 } } },
      { atSecond: 7, request: { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "vm" } } }], next: 0 } };
  await advanceTickBatch(instance, async () => {});
  expect(instance.model2!.simulatedSeconds).toBe(7);
  expect(replayDue(instance)).toBe(true);
  instance.replay!.next = 2; // recorded and applied by the cycle
  // Then on to the submitted stop second, one budgeted batch per cycle, as the worker does.
  for (let cycle = 0; cycle < 20 && !(await advanceTickBatch(instance, async () => {})); cycle++);
  expect(instance.model2!.simulatedSeconds).toBe(30);
});

test("a load balancer shares light traffic between its app servers in turn", () => {
  const def = definition("first-production-api");
  const design = { resources: [["dns", "DNS"], ["lb", "Load Balancer"], ["vm1", "Virtual Machine"], ["vm2", "Virtual Machine"], ["db", "Database"]]
    .map(([id, type], x) => ({ id, type: type as never, x, y: 0 })), connectionLines: [["dns", "lb"], ["lb", "vm1"], ["lb", "vm2"], ["vm1", "db"], ["vm2", "db"]]
    .map(([sourceId, targetId]) => ({ id: `${sourceId}-${targetId}`, sourceId: sourceId!, targetId: targetId!, sourceType: "", targetType: "", port: 443 })) };
  const run = createModel2Engine(captureRunInputs({ ...design, layoutVersion: 3 }, def.workload, "seed-b"), 20, buildModel2Contract);
  for (let s = 0; s < 10; s++) run.advance();
  const { vm1, vm2 } = run.view().metrics;
  expect(Math.abs(vm1!.rps! - vm2!.rps!)).toBeLessThanOrEqual(2);
  expect(vm1!.rps!).toBeGreaterThan(40);
});

test("every challenge's starting design runs on Model 2 at its workload", () => {
  for (const { id, version } of CHALLENGE_VERSIONS.filter((c) => c.version === 1)) {
    const def = findChallenge(id, version)!.definition;
    if (!def.starter) { expect(() => createModel2Engine(captureRunInputs({ resources: [], connectionLines: [], layoutVersion: 3 }, def.workload, "s"), 10, buildModel2Contract)).toThrow(ActionRefused); continue; }
    const run = createModel2Engine(captureRunInputs({ ...def.starter, layoutVersion: 3 }, def.workload, "s"), 10, buildModel2Contract);
    for (let s = 0; s < 10; s++) run.advance();
    expect(run.view().traffic.completedRps).toBeGreaterThan(0);
  }
}, 120000);
