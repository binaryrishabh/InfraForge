import { expect, test } from "bun:test";
import { createInitialState, tick } from "@infraforge/simulation/engine";
import { DeploymentChaosNames, ResourceHealth } from "@infraforge/domain/resource";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import { captureSnapshot } from "../simulator/snapshot";
import { readActionRequest } from "../actions/contract";
import { validateActionTarget } from "../actions/targets";
import { captureRunInputs } from "../deployments/runInputs";
import type { SimulationInstance } from "../simulator/instance";
import { layout, workload } from "./integration/scenario";

function instance(): SimulationInstance {
  return { state: createInitialState("unit-run", layout.resources, layout.connectionLines, workload, 123),
    tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: 0,
    topology: structuredClone(layout), topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: null, metricsTopologyRevision: 0 };
}

test("load records actual previous/applied target; paused controls require no engine tick", () => {
  const run = instance();
  expect(applyAction(run, "pause", { kind: "speed", parameters: { speed: 0 } })).toEqual({ status: "completed", outcome: { previousSpeed: 1, appliedSpeed: 0 } });
  expect(applyAction(run, "load", { kind: "load", parameters: { targetLoadFraction: 0.5 } }).outcome).toEqual({ previousTarget: 1, appliedTarget: 0.5 });
  expect(run.state.loadFraction).toBe(0);
  expect(run.state.simulatedSeconds).toBe(0);
  expect(applyAction(run, "resume", { kind: "speed", parameters: { speed: 60 } }).outcome).toEqual({ previousSpeed: 0, appliedSpeed: 60 });
});

test("chaos completion observes the exact tick within a high-speed batch and does not claim recovery", () => {
  const run = instance();
  const started = applyAction(run, "fault", { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "vm-a" } });
  expect(started.status).toBe("running");
  const action = run.actions.get("fault")!;
  expect(actionCompletion(run, action)).toBeNull();
  let endedAt: number | undefined;
  for (let i = 0; i < 60; i++) {
    run.state = tick(run.state, {}).state;
    const completion = actionCompletion(run, action);
    if (completion && endedAt === undefined) {
      endedAt = run.state.simulatedSeconds;
      expect(completion.outcome.faultEnded).toBe(true);
      expect(completion.outcome.observedOverallHealth).toBe(run.state.overallHealth);
      expect(run.state.metrics["vm-a"]?.health).toBe(ResourceHealth.FAILED);
    }
  }
  expect(endedAt).toBe(SIMULATION_CONSTANTS.CHAOS.CRASH_DURATION);
});

test("vertical scaling completes only after the requested SKU is installed and the target is observed online", () => {
  const run = instance();
  expect(applyAction(run, "vertical", { kind: "vertical-scale", parameters: { resourceId: "vm-a", skuId: "m5.xlarge" } }).status).toBe("running");
  const action = run.actions.get("vertical")!;
  for (let i = 0; i < SIMULATION_CONSTANTS.VERTICAL_SCALING.RESTART_TICKS; i++) {
    run.state = tick(run.state, {}).state;
    expect(actionCompletion(run, action)).toBeNull();
  }
  expect(run.state.resourceSkus["vm-a"]?.skuId).toBe("m5.xlarge");
  run.state = tick(run.state, {}).state;
  expect(actionCompletion(run, action)?.outcome).toMatchObject({ installedSkuId: "m5.xlarge", online: true, fromSkuId: "m5.large" });
});

test("pool operations record the replica transition and actual final counts for provisioning and draining", () => {
  const run = instance();
  for (const [id, delta, final] of [["up", 1, 3], ["down", -1, 2]] as const) {
    expect(applyAction(run, id, { kind: "pool-scale", parameters: { lbId: "lb", delta } }).status).toBe("running");
    const action = run.actions.get(id)!;
    let completed = actionCompletion(run, action);
    for (let tickCount = 0; tickCount < 120 && !completed; tickCount++) {
      run.state = tick(run.state, {}).state;
      completed = actionCompletion(run, action);
    }
    expect(completed?.status).toBe("completed");
    expect(completed?.outcome.finalReplicaCount).toBe(final);
    expect(completed?.outcome.delta).toBe(delta);
    run.actions.delete(id);
  }
});

test("invalid targets/SKUs and impossible pool operations never change simulation state", () => {
  const run = instance();
  const original = structuredClone(run.state);
  for (const request of [
    { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "missing" } },
    { kind: "vertical-scale", parameters: { resourceId: "db", skuId: "m5.xlarge" } },
    { kind: "pool-scale", parameters: { lbId: "missing", delta: 1 } },
    { kind: "pool-scale", parameters: { lbId: "lb", delta: -1 } },
  ] as const) expect(() => applyAction(run, "invalid", request)).toThrow();
  expect(run.state).toEqual(original);
  expect(run.actions.size).toBe(0);
  expect(() => validateActionTarget({ kind: "pool-scale", parameters: { lbId: "dns", delta: 1 } }, layout, captureRunInputs(layout))).toThrow("current");
  expect(() => readActionRequest({ kind: "load", parameters: { targetLoadFraction: 1, arbitrary: "blob" } })).toThrow();
});

test("topology application is revision ordered, preserves original input and cancels removed targets", () => {
  const run = instance();
  applyAction(run, "chaos", { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "vm-a" } });
  const topology = { resources: layout.resources.filter((r) => r.id !== "vm-a"), connectionLines: layout.connectionLines.filter((c) => c.sourceId !== "vm-a" && c.targetId !== "vm-a") };
  expect(applyAction(run, "edit", { kind: "topology", parameters: { ...topology, expectedRevision: 0, acceptedRevision: 1 } }).outcome).toEqual({ acceptedRevision: 1, appliedRevision: 1 });
  expect(actionCompletion(run, run.actions.get("chaos")!)?.status).toBe("cancelled");
  expect(layout.resources.some((r) => r.id === "vm-a")).toBe(true);
  expect(() => applyAction(run, "stale", { kind: "topology", parameters: { ...layout, expectedRevision: 0, acceptedRevision: 2 } })).toThrow("order");
});

test("terminal/checkpoint captures have real time/revision and cannot drift when memory changes", () => {
  const run = instance();
  run.topologyRevision = 3;
  run.accumulatedCostUsd = 0.25;
  const snapshot = captureSnapshot("unit-run", run, "terminal");
  expect(snapshot.kind).toBe("terminal");
  expect(Number.isFinite(Date.parse(snapshot.capturedAt))).toBe(true);
  expect(snapshot.topologyRevision).toBe(3);
  expect(snapshot.accumulatedCostUsd).toBe(0.25);
  run.state.metrics.db!.cpu = 99;
  expect(snapshot.metrics.db?.cpu).toBe(0);
  expect(captureSnapshot("unit-run", run, "checkpoint").kind).toBe("checkpoint");
});
