import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { ClientRetryLiveSchema } from "../reports/clientRetrySchema";
import { readRecords } from "../reports/records";
import { layout, workload } from "./integration/scenario";

test("timeout evidence is present from the initial live view and retained in strict checkpoints", () => {
  const input = captureRunInputs(layout, { ...workload, clientRetry: { version: 1, maxAttempts: 2, backoffMs: 1, attemptTimeoutMs: 1 } }, "timeout-report");
  const run = createModel2Engine(input, 1, buildModel2Contract);
  expect(run.view().traffic.clientRetry).toMatchObject({ attemptsTimedOut: 0, wastedCompletions: 0, supersededOutcomes: { completed: 0, rejected: 0, cancelled: 0 } });
  run.advance(); const view = run.view(), limits: string[] = [];
  expect(view.traffic.clientRetry!.attemptsTimedOut).toBeGreaterThan(0);
  const records = readRecords({ runInputs: input, stages: [], timeline: [], chaosEvents: [], simulationState: view,
    terminalSnapshot: { ...view, version: 1, kind: "terminal", capturedAt: "2026-11-03T00:00:00.000Z", topologyRevision: 0, accumulatedCostUsd: 0 } }, limits);
  expect(records.checkpoint!.traffic).toEqual(view.traffic); expect(records.terminal!.traffic).toEqual(view.traffic); expect(limits).toEqual([]);
  const metrics = view.traffic.clientRetry!;
  for (const key of ["attemptsTimedOut", "wastedCompletions", "timeoutCancellationsRequested", "timeoutCancellationsConfirmed", "recoveredByTimeoutRetry"]) {
    for (const value of [-1, 1.5, Infinity, NaN, 100_000_001]) expect(ClientRetryLiveSchema.safeParse({ ...metrics, [key]: value }).success).toBe(false);
  }
  expect(ClientRetryLiveSchema.safeParse({ ...metrics, extra: true }).success).toBe(false);
  expect(ClientRetryLiveSchema.safeParse({ ...metrics, supersededOutcomes: { completed: 1, rejected: 0, cancelled: Infinity } }).success).toBe(false);
});
