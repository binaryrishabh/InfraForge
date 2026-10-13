import type { RunReport, RunSummary } from "@infraforge/contracts/reports";
import { readRecords } from "./records";
import { topologyChanges, topologySummary } from "./topology";
import { readReportActions } from "./actions";
import type { RunAction as StoredAction } from "../lib/generated/prisma/client";
import { evaluateAttempt } from "../challenges/evaluate";

export interface StoredRun {
  id: string; infrastructureId: string | null; runName?: string | null; status: string; resourceCount: number;
  createdAt: Date; updatedAt: Date; topologyRevision: number;
  stages: unknown; timeline: unknown; chaosEvents: unknown; workloadProfile: unknown; seed: string | null;
  simulationState: unknown; runInputs: unknown; liveTopology: unknown;
  terminalSnapshot?: unknown; actions?: StoredAction[]; actionCount?: number; durableChaosCount?: number;
  sourceRunId?: string | null; sourceRun?: { runName: string | null } | null; rerunMode?: string | null; autoStopAtSimulatedSeconds?: number | null;
  runtimeActive?: boolean; challengeId?: string | null; challengeVersion?: number | null; challengeSpecHash?: string | null;
  challengePrediction?: unknown; predictionSubmittedAt?: Date | null; evaluationStopAtSimulatedSeconds?: number | null;
}

type Records = ReturnType<typeof readRecords>;
const failureOf = (records: Records) => records.timeline.filter((e) => e.event === "Deployment Failed" || e.event === "Simulation Interrupted").at(-1);

// Challenge results are derived from the run's own evidence on every read; nothing is stored as a score.
function challengeOf(row: StoredRun, records: Records) {
  if (!row.challengeId) return null;
  return evaluateAttempt({ challengeId: row.challengeId, challengeVersion: row.challengeVersion ?? null,
    challengeSpecHash: row.challengeSpecHash ?? null, challengePrediction: row.challengePrediction,
    predictionSubmittedAt: row.predictionSubmittedAt ?? null, evaluationStopAtSimulatedSeconds: row.evaluationStopAtSimulatedSeconds ?? null },
  { status: row.status, runtimeActive: !!row.runtimeActive, input: records.input, stages: records.stages, terminal: records.terminal,
    failure: row.status === "failed" ? failureOf(records)?.message ?? "The run failed without a recorded message." : null });
}

function summary(row: StoredRun, records: Records, challenge = challengeOf(row, records)): RunSummary {
  return { id: row.id, infrastructureId: row.infrastructureId, infrastructureName: row.runName ?? "Unnamed legacy run",
    status: row.status, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    resourceCount: row.resourceCount, workload: records.input?.workloadProfile ?? records.legacyWorkload,
    workloadSource: records.input ? "captured" : records.legacyWorkload ? "legacy" : "unavailable",
    chaosEventCount: Array.isArray(row.chaosEvents) && row.chaosEvents.length === records.chaos.length ? records.chaos.length + (row.durableChaosCount ?? row.actions?.filter((a) => a.kind === "chaos").length ?? 0) : null,
    topologyRevision: Number.isSafeInteger(row.topologyRevision) && row.topologyRevision >= 0 ? row.topologyRevision : null,
    actionCount: row.actionCount ?? row.actions?.length ?? 0,
    sourceRunId: row.sourceRunId ?? null, sourceRunName: row.sourceRun?.runName ?? null,
    rerunMode: row.rerunMode === "exact" || row.rerunMode === "current-design" ? row.rerunMode : null,
    autoStopAtSimulatedSeconds: row.autoStopAtSimulatedSeconds ?? null,
    challenge: challenge ? { id: challenge.challengeId, version: challenge.version, title: challenge.title, status: challenge.status,
      metCount: challenge.metCount, total: challenge.total } : null,
    hasReportData: !!(records.stages.length || records.timeline.length || records.chaos.length || records.checkpoint || records.terminal || row.actionCount || row.actions?.length) };
}

export function summarizeRun(row: StoredRun): RunSummary { return summary(row, readRecords(row, [])); }

export function buildRunReport(row: StoredRun): RunReport {
  const limits: string[] = [];
  const records = readRecords(row, limits);
  const challenge = challengeOf(row, records);
  const run = summary(row, records, challenge);
  const report: RunReport = { version: 1, run, originalSeed: records.input?.seed ?? null,
    legacySeed: !records.input && typeof row.seed === "string" ? row.seed : null,
    stages: records.stages, timeline: records.timeline, chaosEvents: records.chaos,
    provenance: { inputVersion: records.input?.version ?? null,
      simulationModelVersion: records.input?.version === 2 ? records.input.simulationModelVersion : null,
      catalogSnapshot: records.input?.version === 2 ? records.input.catalogSnapshot : null },
    actions: readReportActions(row.actions, limits), terminal: records.terminal,
    topology: { original: topologySummary(records.input), accepted: topologySummary(records.live),
      changes: topologyChanges(records.input, records.live) }, checkpoint: records.checkpoint,
    observed: [{ id: "status", message: `The stored run status is ${run.status}.`, sources: ["status"] }],
    interpreted: [], unknown: limits, inspectNext: [], challenge };
  if (records.input && records.live && !report.topology.changes) {
    report.unknown.push("Duplicate resource identifiers or connections make the original/live topology comparison ambiguous; no edits were inferred.");
  }
  if (run.chaosEventCount !== null) report.observed.push({ id: "chaos-requests",
    message: run.chaosEventCount === 1 ? "1 chaos request was recorded." : `${run.chaosEventCount} chaos requests were recorded.`, sources: ["chaosEvents", "RunAction"] });
  if (run.topologyRevision !== null) report.observed.push({ id: "revision",
    message: `The last accepted live topology revision is ${run.topologyRevision}.`, sources: ["topologyRevision", "liveTopology"] });
  const failure = failureOf(records);
  if (failure && run.status === "failed") {
    report.observed.push({ id: "failure", message: failure.message, sources: ["timeline"] });
    report.inspectNext.push("Start with the recorded failure message and original inputs before rerunning.");
  }
  const checkpoint = records.terminal ?? records.checkpoint;
  const snapshotSource = records.terminal ? "terminalSnapshot" : "simulationState";
  if (checkpoint) {
    if (checkpoint.health) report.observed.push({ id: "checkpoint-health",
      message: `${records.terminal ? "The exact terminal snapshot" : "The latest retained checkpoint"} records overall health as ${checkpoint.health}.`, sources: [`${snapshotSource}.overallHealth`] });
    for (const resource of checkpoint.resources) {
      if (resource.cpu !== undefined && resource.cpu >= 90) report.interpreted.push({ id: `cpu-headroom:${resource.id}`,
        message: `${resource.id} had at most 10 percentage points of CPU headroom at this ${records.terminal ? "terminal snapshot" : "checkpoint"} (${resource.cpu}%). This does not establish how long it stayed there.`,
        sources: [`${snapshotSource}.metrics.${resource.id}.cpu`] });
    }
    if (checkpoint.resources.some((r) => r.health && r.health !== "healthy")) report.inspectNext.push("Inspect the unhealthy checkpoint resources and their upstream connections; one snapshot cannot establish the cause.");
    if (checkpoint.capturedAt) report.observed.push({ id: "snapshot-capture", message: `This ${records.terminal ? "terminal snapshot" : "checkpoint"} was captured at ${checkpoint.capturedAt}; simulator topology revision ${checkpoint.topologyRevision ?? "unknown"}.`,
      sources: [`${snapshotSource}.capturedAt`, `${snapshotSource}.topologyRevision`] });
    else report.unknown.push("The checkpoint has no retained capture timestamp. The run's updated time is not its measurement time, and measurements may predate the last controls or teardown.");
    if (!records.terminal) report.unknown.push("Checkpoint evidence is not an exact final state; it may predate later controls or teardown.");
    if (checkpoint.metricsComputedAt === null) report.unknown.push("No engine tick computed these resource measurements; the snapshot contains initialized simulator values.");
    if (checkpoint.metricsTopologyRevision !== undefined && checkpoint.topologyRevision !== checkpoint.metricsTopologyRevision) {
      report.unknown.push("Resource measurements were computed before the captured topology revision was applied. The exact state includes those retained measurements, not a recomputation of the new topology.");
    }
  } else report.unknown.push("No usable simulation checkpoint was retained. Final resource health, CPU, memory and accumulated cost are unknown.");
  if (!records.input) report.unknown.push("No usable immutable run input exists. The current saved design cannot establish what this deployment originally ran.");
  if (records.chaos.length) report.unknown.push("Chaos records show accepted requests, not proof of their full effect, causality, recovery or cost impact.");
  if (run.topologyRevision && report.topology.changes) report.interpreted.push({ id: "accepted-topology-diff",
    message: `Compared with the original input, resource changes in the last accepted topology are: ${report.topology.changes.added.length} added, ${report.topology.changes.removed.length} removed and ${report.topology.changes.reconfigured.length} reconfigured. Acceptance does not prove the simulator had applied that revision at the checkpoint.`,
    sources: ["runInputs", "liveTopology", "topologyRevision"] });
  if (records.input?.version !== 2) report.unknown.push("This legacy input has no captured simulation-model/catalog provenance. Its recorded name may have been backfilled from the design at migration.");
  report.unknown.push(records.input?.version === 2 ? "Durable actions record request, application and outcome; continuous telemetry and all automatic scaling events are not retained."
    : "A full historical telemetry series and intermediate topology revisions are not retained. Streamed scaling, restart, load and speed changes may be absent from this report.");
  report.unknown.push("Monthly estimates and checkpoint cost are educational model values, not cloud bills. A cost change caused by chaos cannot be established from these records.");
  report.inspectNext.push("Compare the recorded workload and original architecture, make one deliberate change, then rerun with the same workload to compare outcomes.");
  report.unknown = [...new Set(report.unknown)];
  return report;
}
