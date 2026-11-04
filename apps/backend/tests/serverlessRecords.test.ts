import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { captureSnapshot } from "../simulator/snapshot";
import { readRecords } from "../reports/records";
import type { SimulationInstance } from "../simulator/instance";
import { functionLayout, functionWorkload } from "./serverless.fixture";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
test("function terminal retains lifecycle evidence, refuses inconsistent accounting, and keeps price Unknown", () => {
  const topology = functionLayout(), input = captureRunInputs(topology, functionWorkload, "function-records"), model2 = createModel2Engine(input, 2, buildModel2Contract);
  model2.advance(); model2.advance();
  expect(() => model2.apply({ kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "fn" } })).toThrow("Crash unsupported");
  const instance: SimulationInstance = { model2, tickCount: 2, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: undefined, topology, topologyRevision: 0, actions: new Map(), acknowledge: null, metricsComputedAt: "2026-11-04T00:00:00.000Z", metricsTopologyRevision: 0 };
  const snapshot = captureSnapshot("run", instance, "terminal"), row = { stages: [], timeline: [], chaosEvents: [], runInputs: input, terminalSnapshot: snapshot };
  expect(snapshot).toMatchObject({ version: 2, costCoverage: "unknown" });
  const limitations: string[] = [], records = readRecords(row, limitations);
  expect(limitations).toEqual([]); expect(records.terminal?.resources.find(r => r.id === "fn")?.serverless?.completed).toBeGreaterThan(0);
  const metrics = snapshot.metrics.fn!.serverless!;
  expect(metrics.lifecycle!.settled).toBe(metrics.admitted - metrics.active);
  expect(metrics.lifecycle!.busyUs).toBeGreaterThan(0);
  expect(records.terminal?.resources.find(r => r.id === "fn")?.serverless).toEqual(metrics);
  const legacy = structuredClone(snapshot); delete legacy.metrics.fn!.serverless!.lifecycle;
  expect(readRecords({ ...row, terminalSnapshot: legacy }, []).terminal?.resources.find(r => r.id === "fn")?.serverless?.lifecycle).toBeUndefined();
  for (const key of ["initializing", "executing", "downstream", "settled", "initializationUs", "executionUs", "downstreamUs", "busyUs"] as const) {
    const bad = structuredClone(snapshot); bad.metrics.fn!.serverless!.lifecycle![key]++;
    expect(readRecords({ ...row, terminalSnapshot: bad }, []).terminal).toBeNull();
  }
  const corrupt = structuredClone(snapshot); corrupt.metrics.fn!.serverless!.completed++;
  expect(readRecords({ ...row, terminalSnapshot: corrupt }, []).terminal).toBeNull();
});
