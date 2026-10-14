import { expect, test } from "bun:test";
import { createInitialState, tick } from "@infraforge/simulation/engine";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { advanceTickBatch, experimentDue, reachedMatchedStop } from "../simulator/tickBatch";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import { captureSnapshot } from "../simulator/snapshot";
import type { SimulationInstance } from "../simulator/instance";
import { captureRunInputs, engineSeed } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { EXPERIMENT_TRIGGER, recordedExperiment } from "../challenges/experiment";
import { definition } from "./challengeHarness";

const d = definition("lose-an-app-server");
const plan = recordedExperiment(d)!;
const fault = { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "app-2", trigger: EXPERIMENT_TRIGGER } } as const;

function instance(speed: number, start: number): SimulationInstance {
  const input = captureRunInputs({ ...d.starter!, layoutVersion: 3 }, d.workload, challengeSeed(d));
  let state = createInitialState("experiment", input.resources, input.connectionLines, input.workloadProfile, engineSeed(input.seed));
  for (let i = 0; i < start; i++) state = tick(state, {}).state;
  return { state, speed, tickCount: start, pendingLogs: [], lastCheckpointAt: 0, accumulatedCostUsd: 0, topology: input, topologyRevision: 0,
    actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0,
    autoStopAtSimulatedSeconds: d.evaluationSeconds, stopTrigger: "challenge-evaluation", experiment: { plan, phase: "scheduled" } };
}

for (const [speed, start] of [[1, 57], [10, 55], [60, 0]] as const) {
  test(`${speed}x stops exactly at the scheduled second${speed > 1 ? " inside its batch" : ""}, then stays frozen until the fault is applied`, async () => {
    const run = instance(speed, start);
    const ticked: number[] = [];
    while (!experimentDue(run)) await advanceTickBatch(run, async (r) => { ticked.push(r.state.simulatedSeconds); });
    expect(run.state.simulatedSeconds).toBe(60);
    expect(ticked.at(-1)).toBe(60);
    // The durable write may fail any number of times: the run never moves past second 60 meanwhile.
    for (const phase of ["scheduled", "requested"] as const) {
      run.experiment!.phase = phase;
      await advanceTickBatch(run, async () => { throw new Error(`no tick while ${phase}`); });
      expect(run.state.simulatedSeconds).toBe(60);
    }
  });
}

test("the fault applies at the second it was due, records its baseline, and the evaluation lands on its last active second", async () => {
  const run = instance(60, 0);
  while (!experimentDue(run)) await advanceTickBatch(run, async () => {});
  const baseline = run.state.overallHealth;
  const applied = applyAction(run, "fault", fault);
  run.experiment!.phase = "applied";
  expect(applied).toEqual({ status: "running", outcome: { durationSimulatedSeconds: 30, baselineOverallHealth: baseline } });
  expect(baseline).toBe("healthy");
  let completedAt: number | undefined;
  while (!reachedMatchedStop(run)) await advanceTickBatch(run, async (r) => {
    const done = actionCompletion(r, r.actions.get("fault")!);
    if (done && completedAt === undefined) { completedAt = r.state.simulatedSeconds; expect(done.outcome).toMatchObject({ faultEnded: true, observedOverallHealth: "critical" }); }
  });
  // Completion is recorded inside the tick that reaches 90, before the terminal capture at 90.
  expect(completedAt).toBe(90);
  const terminal = captureSnapshot("experiment", run, "terminal");
  expect(terminal.simulatedSeconds).toBe(90);
  expect(terminal.metrics["app-2"]?.health as string).toBe("failed");
  expect(terminal.activeChaos).toEqual([]);
});

test("a completion due at the scheduled second is recorded before the fault is applied", async () => {
  const run = instance(60, 20);
  applyAction(run, "earlier", { kind: "chaos", parameters: { type: DeploymentChaosNames.CpuSpike, resourceId: "db" } });
  const order: string[] = [];
  while (!experimentDue(run)) await advanceTickBatch(run, async (r) => {
    if (r.actions.has("earlier") && actionCompletion(r, r.actions.get("earlier")!)) { order.push(`completed earlier at ${r.state.simulatedSeconds}`); r.actions.delete("earlier"); }
  });
  order.push(`fault applied at ${run.state.simulatedSeconds}`);
  applyAction(run, "fault", fault);
  expect(order).toEqual(["completed earlier at 40", "fault applied at 60"]);
});

test("a fault recorded as failed releases the run without pretending it happened", async () => {
  const run = instance(60, 0);
  while (!experimentDue(run)) await advanceTickBatch(run, async () => {});
  run.experiment!.phase = "failed";
  expect(experimentDue(run)).toBe(false);
  await advanceTickBatch(run, async () => {});
  expect(run.state.simulatedSeconds).toBe(90);
  expect(run.state.activeChaos).toEqual([]);
});

test("freeform faults keep their existing outcome, and runs without a plan never wait", async () => {
  const freeform = instance(60, 0);
  freeform.experiment = null;
  expect(applyAction(freeform, "manual", { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "app-2" } }).outcome).toEqual({ durationSimulatedSeconds: 30 });
  await advanceTickBatch(freeform, async () => {});
  expect(freeform.state.simulatedSeconds).toBe(60);
  expect(experimentDue(freeform)).toBe(false);
});
