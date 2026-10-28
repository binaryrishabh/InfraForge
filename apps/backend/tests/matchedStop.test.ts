import { expect, test } from "bun:test";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { advanceTickBatch, reachedMatchedStop } from "../simulator/tickBatch";
import { captureSnapshot } from "../simulator/snapshot";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import { currentSecond } from "../simulator/engineView";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { captureRunInputs } from "../deployments/runInputs";
import type { SimulationInstance } from "../simulator/instance";
import { layout, workload } from "./integration/scenario";

function instance(speed: number, start = 60, target = 80): SimulationInstance {
  const input = { ...captureRunInputs(layout, workload), seed: "matched-stop" };
  const model2 = createModel2Engine(input, target, buildModel2Contract);
  for (let i = 0; i < start; i++) model2.advance();
  return { model2, speed, autoStopAtSimulatedSeconds: target, tickCount: start, pendingLogs: [], lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: layout, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: null, metricsTopologyRevision: 0 };
}
for (const speed of [1, 10, 60]) test(`${speed}x stops exactly at 80, including inside a 60x batch`, async () => {
  const run = instance(speed);
  const completed: number[] = [];
  while (!reachedMatchedStop(run)) await advanceTickBatch(run, async (r) => { completed.push(currentSecond(r)); });
  expect(completed).toEqual(Array.from({ length: 20 }, (_, i) => 61 + i));
  expect(captureSnapshot("rerun", run, "terminal").simulatedSeconds).toBe(80);
  await advanceTickBatch(run, async () => { throw new Error("Must stay frozen at target"); });
  expect(currentSecond(run)).toBe(80);
}, 60000);
test("running action completion at the target precedes terminal capture", async () => {
  const run = instance(60, 0, SIMULATION_CONSTANTS.CHAOS.CRASH_DURATION);
  applyAction(run, "fault", { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "vm-a" } });
  let completionSecond: number | undefined;
  while (!reachedMatchedStop(run)) await advanceTickBatch(run, async (r) => {
    if (actionCompletion(r, r.actions.get("fault")!)) completionSecond = currentSecond(r);
  });
  const terminal = captureSnapshot("rerun", run, "terminal");
  expect(completionSecond).toBe(run.autoStopAtSimulatedSeconds!);
  expect(terminal.simulatedSeconds).toBe(completionSecond!);
}, 60000);
test("a failed completion acknowledgement at the target cannot overshoot on retry", async () => {
  const run = instance(60);
  let failure: unknown;
  while (!failure) await advanceTickBatch(run, async (r) => { if (currentSecond(r) === 80) throw new Error("write failed"); }).catch((error) => { failure = error; });
  expect(String(failure)).toContain("write failed");
  const original = captureSnapshot("rerun", run, "terminal");
  for (let retry = 0; retry < 3; retry++) await advanceTickBatch(run, async () => { throw new Error("No new ticks"); });
  expect(currentSecond(run)).toBe(80);
  expect(run.model2.view().metrics).toEqual(original.metrics);
}, 60000);
test("pause and manual stop do not advance to the matched target", async () => {
  const paused = instance(0);
  expect(await advanceTickBatch(paused, async () => {})).toBe(false);
  expect(currentSecond(paused)).toBe(60);
  const stopped = instance(60);
  expect(await advanceTickBatch(stopped, async () => {}, () => true)).toBe(false);
  expect(captureSnapshot("rerun", stopped, "terminal").simulatedSeconds).toBe(60);
}, 60000);
