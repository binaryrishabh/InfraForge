import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { readRecords } from "../reports/records";
import { buildRunReport, type StoredRun } from "../reports/report";
import { layout, workload } from "./integration/scenario";

export function timeoutReportFixture() {
  const input = captureRunInputs(layout, {...workload, clientRetry: {version: 1, maxAttempts: 2, backoffMs: 1, attemptTimeoutMs: 1}}, "timeout-report");
  const run = createModel2Engine(input, 2);
  run.advance(); run.advance(); const view = run.view();
  const snapshot = {...view, version: 1, kind: "terminal", capturedAt: "2026-11-08T00:00:00.000Z", topologyRevision: 0, accumulatedCostUsd: 0};
  const row = {id: "timeout-evidence", infrastructureId: null, runName: "Client timeout evidence", status: "torn-down",
    resourceCount: input.resources.length, createdAt: new Date(snapshot.capturedAt), updatedAt: new Date(snapshot.capturedAt), topologyRevision: 0,
    stages: [], timeline: [], chaosEvents: [], workloadProfile: input.workloadProfile, seed: input.seed,
    simulationState: null, runInputs: input, liveTopology: input, terminalSnapshot: JSON.parse(JSON.stringify(snapshot))} satisfies StoredRun;
  const report = buildRunReport(row);
  const old = structuredClone(row);
  const retry = old.terminalSnapshot.traffic.clientRetry;
  for (const key of ["attemptsTimedOut", "wastedCompletions", "timeoutCancellationsRequested", "timeoutCancellationsConfirmed", "recoveredByTimeoutRetry", "supersededOutcomes"]) delete retry[key];
  const absent = structuredClone(old); delete absent.terminalSnapshot.traffic.clientRetry;
  const noTraffic = structuredClone(row); delete noTraffic.terminalSnapshot.traffic;
  return {report, noTraffic: buildRunReport(noTraffic), old: buildRunReport(old), absent: buildRunReport(absent), traffic: view.traffic,
    records: readRecords({simulationState: snapshot, terminalSnapshot: snapshot, stages: [], timeline: [], chaosEvents: []}, [])};
}
if (import.meta.main) console.log(JSON.stringify(timeoutReportFixture()));
