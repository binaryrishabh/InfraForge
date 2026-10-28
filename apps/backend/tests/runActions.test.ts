import { expect, test } from "bun:test";
import { DeploymentChaosNames, ResourceHealth } from "@infraforge/domain/resource";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import { captureSnapshot } from "../simulator/snapshot";
import { currentSecond } from "../simulator/engineView";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { readActionRequest } from "../actions/contract";
import { captureRunInputs } from "../deployments/runInputs";
import type { SimulationInstance } from "../simulator/instance";
import { layout, workload } from "./integration/scenario";

// The load balancer's autoscaling switched on, so its two app servers form a pool of 2 to 3 replicas.
const pooled = { ...layout, resources: layout.resources.map((r) => r.id === "lb" ? { ...r, autoscaling: { ...r.autoscaling, enabled: true } } : r) };
function instance(design = layout): SimulationInstance {
  const input = { ...captureRunInputs(design, workload), seed: "unit-run" };
  return { model2: createModel2Engine(input, 120, buildModel2Contract),
    tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: 0,
    topology: structuredClone(design), topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: null, metricsTopologyRevision: 0 };
}

test("load records actual previous/applied target; paused controls require no engine tick", () => {
  const run = instance();
  expect(applyAction(run, "pause", { kind: "speed", parameters: { speed: 0 } })).toEqual({ status: "completed", outcome: { previousSpeed: 1, appliedSpeed: 0 } });
  expect(applyAction(run, "load", { kind: "load", parameters: { targetLoadFraction: 0.5 } }).outcome).toEqual({ previousTarget: 1, appliedTarget: 0.5 });
  expect(currentSecond(run)).toBe(0);
  expect(applyAction(run, "resume", { kind: "speed", parameters: { speed: 60 } }).outcome).toEqual({ previousSpeed: 0, appliedSpeed: 60 });
}, 60000);

test("chaos completion observes the exact second the fault ends and does not claim recovery", () => {
  const run = instance();
  const started = applyAction(run, "fault", { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "vm-a" } });
  expect(started.status).toBe("running");
  const action = run.actions.get("fault")!;
  expect(actionCompletion(run, action)).toBeNull();
  let endedAt: number | undefined;
  for (let i = 0; i < 60; i++) {
    run.model2.advance();
    const completion = actionCompletion(run, action);
    if (completion && endedAt === undefined) {
      endedAt = currentSecond(run);
      const view = run.model2.view();
      expect(completion.outcome.faultEnded).toBe(true);
      expect(completion.outcome.observedOverallHealth).toBe(view.overallHealth);
      expect(view.metrics["vm-a"]?.health).toBe(ResourceHealth.FAILED);
    }
  }
  expect(endedAt).toBe(SIMULATION_CONSTANTS.CHAOS.CRASH_DURATION);
}, 60000);

test("pool operations record the replica change and the actual final counts for provisioning and draining", () => {
  const run = instance(pooled);
  run.model2.advance();
  // Counts are the balancer's totals, as the user set them: Model 2 scales one server and keeps its sibling fixed.
  expect(run.model2.view().pools.lb).toMatchObject({ minReplicas: 2, maxReplicas: 3, currentReplicas: 2 });
  for (const [id, delta, final] of [["up", 1, 3], ["down", -1, 2]] as const) {
    expect(applyAction(run, id, { kind: "pool-scale", parameters: { lbId: "lb", delta } }).status).toBe("running");
    const action = run.actions.get(id)!;
    let completed = actionCompletion(run, action);
    for (let second = 0; second < 60 && !completed; second++) {
      run.model2.advance();
      completed = actionCompletion(run, action);
    }
    expect(completed?.status).toBe("completed");
    expect(completed?.outcome.finalReplicaCount).toBe(final);
    expect(completed?.outcome.delta).toBe(delta);
    run.actions.delete(id);
  }
}, 60000);

test("invalid targets, impossible pool changes, resizing and live topology edits are refused without changing the run", () => {
  const run = instance(pooled);
  run.model2.advance();
  const before = JSON.stringify(run.model2.view());
  for (const request of [
    { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "missing" } },
    { kind: "pool-scale", parameters: { lbId: "missing", delta: 1 } },
    { kind: "pool-scale", parameters: { lbId: "lb", delta: -1 } },
    { kind: "vertical-scale", parameters: { resourceId: "vm-a", skuId: "m5.xlarge" } },
    { kind: "topology", parameters: { ...layout, expectedRevision: 0, acceptedRevision: 1 } },
  ] as const) expect(() => applyAction(run, "invalid", request)).toThrow();
  expect(JSON.stringify(run.model2.view())).toBe(before);
  expect(run.actions.size).toBe(0);
  expect(() => readActionRequest({ kind: "load", parameters: { targetLoadFraction: 1, arbitrary: "blob" } })).toThrow();
}, 60000);

test("terminal/checkpoint captures have real time/revision and cannot drift as the run continues", () => {
  const run = instance();
  run.model2.advance();
  run.topologyRevision = 3;
  run.accumulatedCostUsd = 0.25;
  const snapshot = captureSnapshot("unit-run", run, "terminal");
  const captured = JSON.stringify(snapshot.metrics);
  expect(snapshot.kind).toBe("terminal");
  expect(Number.isFinite(Date.parse(snapshot.capturedAt))).toBe(true);
  expect(snapshot.topologyRevision).toBe(3);
  expect(snapshot.accumulatedCostUsd).toBe(0.25);
  for (let i = 0; i < 5; i++) run.model2.advance();
  expect(snapshot.simulatedSeconds).toBe(1);
  expect(JSON.stringify(snapshot.metrics)).toBe(captured);
  expect(captureSnapshot("unit-run", run, "checkpoint").kind).toBe("checkpoint");
}, 60000);
