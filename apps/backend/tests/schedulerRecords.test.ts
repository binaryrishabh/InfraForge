import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { captureSnapshot } from "../simulator/snapshot";
import { readRecords } from "../reports/records";
import type { SimulationInstance } from "../simulator/instance";
import { schedulerLayout, schedulerWorkload } from "./scheduler.fixture";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
test("scheduler terminal retains its counters, refuses corrupt accounting, and leaves cost Unknown", () => {
  const topology = schedulerLayout(), input = captureRunInputs(topology, schedulerWorkload, "scheduler-records"), model2 = createModel2Engine(input, 2, buildModel2Contract);
  model2.advance(); model2.advance();
  expect(() => model2.apply({ kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "timer" } })).toThrow("Crash unsupported");
  const instance: SimulationInstance = { model2, tickCount: 2, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: undefined, topology, topologyRevision: 0, actions: new Map(), acknowledge: null, metricsComputedAt: "2026-11-04T00:00:00.000Z", metricsTopologyRevision: 0 };
  const snapshot = captureSnapshot("run", instance, "terminal"), row = { stages: [], timeline: [], chaosEvents: [], runInputs: input, terminalSnapshot: snapshot };
  expect(snapshot).toMatchObject({ version: 2, costCoverage: "unknown" });
  const limitations: string[] = [], records = readRecords(row, limitations);
  expect(limitations).toEqual([]); expect(records.terminal?.resources.find(r => r.id === "timer")?.scheduler).toMatchObject({ completed: 100, missed: 0 });
  const metrics = snapshot.metrics.timer!.scheduler!;
  expect(metrics.attemptAccounting).toMatchObject({ started: 100, failedAttempts: 0, pendingAttempts: 0, retryWaiting: 0 });
  expect(records.terminal?.resources.find(r => r.id === "timer")?.scheduler).toEqual(metrics);
  const legacy = structuredClone(snapshot); delete legacy.metrics.timer!.scheduler!.attemptAccounting;
  expect(readRecords({ ...row, terminalSnapshot: legacy }, []).terminal?.resources.find(r => r.id === "timer")?.scheduler?.attemptAccounting).toBeUndefined();
  for (const key of ["started", "failedAttempts", "timedOutAttempts", "pendingAttempts", "retryWaiting", "delayedStarts", "maxStartDelayUs", "totalStartDelayUs"] as const) {
    const bad = structuredClone(snapshot); bad.metrics.timer!.scheduler!.attemptAccounting![key]++;
    expect(readRecords({ ...row, terminalSnapshot: bad }, []).terminal).toBeNull();
  }
  const corrupt = structuredClone(snapshot); corrupt.metrics.timer!.scheduler!.completed++;
  expect(readRecords({ ...row, terminalSnapshot: corrupt }, []).terminal).toBeNull();
});
