import { expect, test } from "bun:test";
import { createInitialState, tick } from "@infraforge/simulation/engine";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { advanceTickBatch, reachedMatchedStop } from "../simulator/tickBatch";
import { captureSnapshot } from "../simulator/snapshot";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import type { SimulationInstance } from "../simulator/instance";
import { layout, workload } from "./integration/scenario";

function instance(speed: number, start = 600, target = 620): SimulationInstance {
  let state = createInitialState("rerun", layout.resources, layout.connectionLines, workload, 123);
  for (let i = 0; i < start; i++) state = tick(state, {}).state;
  return { state, speed, autoStopAtSimulatedSeconds: target, tickCount: start, pendingLogs: [], lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: layout, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: null, metricsTopologyRevision: 0 };
}
for (const speed of [1, 10, 60]) test(`${speed}x stops exactly at 620, including inside a 60x batch`, async () => {
  const run = instance(speed);
  const completed: number[] = [];
  while (!reachedMatchedStop(run)) await advanceTickBatch(run, async (r) => { completed.push(r.state!.simulatedSeconds); });
  expect(completed).toEqual(Array.from({ length: 20 }, (_, i) => 601 + i));
  expect(captureSnapshot("rerun", run, "terminal").simulatedSeconds).toBe(620);
  await advanceTickBatch(run, async () => { throw new Error("Must stay frozen at target"); });
  expect(run.state!.simulatedSeconds).toBe(620);
});
test("running action completion at the target precedes terminal capture", async () => {
  const run = instance(60, 0, SIMULATION_CONSTANTS.CHAOS.CRASH_DURATION);
  applyAction(run, "fault", { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "vm-a" } });
  let completionSecond: number | undefined;
  await advanceTickBatch(run, async (r) => {
    if (actionCompletion(r, r.actions.get("fault")!)) completionSecond = r.state!.simulatedSeconds;
  });
  const terminal = captureSnapshot("rerun", run, "terminal");
  expect(completionSecond).toBe(run.autoStopAtSimulatedSeconds!);
  expect(terminal.simulatedSeconds).toBe(completionSecond!);
});
test("a failed completion acknowledgement at the target cannot overshoot on retry", async () => {
  const run = instance(60);
  await expect(advanceTickBatch(run, async (r) => { if (r.state!.simulatedSeconds === 620) throw new Error("write failed"); })).rejects.toThrow("write failed");
  const original = captureSnapshot("rerun", run, "terminal");
  for (let retry = 0; retry < 3; retry++) await advanceTickBatch(run, async () => { throw new Error("No new ticks"); });
  expect(run.state!.simulatedSeconds).toBe(620);
  expect(run.state!.metrics).toEqual(original.metrics);
});
test("pause and manual stop do not advance to the matched target", async () => {
  const paused = instance(0);
  expect(await advanceTickBatch(paused, async () => {})).toBe(false);
  expect(paused.state!.simulatedSeconds).toBe(600);
  const stopped = instance(60);
  expect(await advanceTickBatch(stopped, async () => {}, () => true)).toBe(false);
  expect(captureSnapshot("rerun", stopped, "terminal").simulatedSeconds).toBe(600);
});
