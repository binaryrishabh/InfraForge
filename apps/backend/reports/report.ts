import type { RunReport, RunSummary } from "@infraforge/contracts/reports";
import { readRecords } from "./records";
import { topologyChanges, topologySummary } from "./topology";

export interface StoredRun {
  id: string; infrastructureId: string; infrastructure: { name: string }; status: string; resourceCount: number;
  createdAt: Date; updatedAt: Date; topologyRevision: number;
  stages: unknown; timeline: unknown; chaosEvents: unknown; workloadProfile: unknown; seed: string | null;
  simulationState: unknown; runInputs: unknown; liveTopology: unknown;
}

function summary(row: StoredRun, records: ReturnType<typeof readRecords>): RunSummary {
  return { id: row.id, infrastructureId: row.infrastructureId, infrastructureName: row.infrastructure.name,
    status: row.status, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    resourceCount: row.resourceCount, workload: records.input?.workloadProfile ?? records.legacyWorkload,
    workloadSource: records.input ? "captured" : records.legacyWorkload ? "legacy" : "unavailable",
    chaosEventCount: Array.isArray(row.chaosEvents) && row.chaosEvents.length === records.chaos.length ? records.chaos.length : null,
    topologyRevision: Number.isSafeInteger(row.topologyRevision) && row.topologyRevision >= 0 ? row.topologyRevision : null,
    hasReportData: !!(records.stages.length || records.timeline.length || records.chaos.length || records.checkpoint) };
}

export function summarizeRun(row: StoredRun): RunSummary { return summary(row, readRecords(row, [])); }

export function buildRunReport(row: StoredRun): RunReport {
  const limits: string[] = [];
  const records = readRecords(row, limits);
  const run = summary(row, records);
  const report: RunReport = { version: 1, run, originalSeed: records.input?.seed ?? null,
    legacySeed: !records.input && typeof row.seed === "string" ? row.seed : null,
    stages: records.stages, timeline: records.timeline, chaosEvents: records.chaos,
    topology: { original: topologySummary(records.input), accepted: topologySummary(records.live),
      changes: topologyChanges(records.input, records.live) }, checkpoint: records.checkpoint,
    observed: [{ id: "status", message: `The stored run status is ${run.status}.`, sources: ["status"] }],
    interpreted: [], unknown: limits, inspectNext: [] };
  if (records.input && records.live && !report.topology.changes) {
    report.unknown.push("Duplicate resource identifiers or connections make the original/live topology comparison ambiguous; no edits were inferred.");
  }
  if (run.chaosEventCount !== null) report.observed.push({ id: "chaos-requests",
    message: run.chaosEventCount === 1 ? "1 chaos request was recorded." : `${run.chaosEventCount} chaos requests were recorded.`, sources: ["chaosEvents"] });
  if (run.topologyRevision !== null) report.observed.push({ id: "revision",
    message: `The last accepted live topology revision is ${run.topologyRevision}.`, sources: ["topologyRevision", "liveTopology"] });
  const failure = records.timeline.filter((event) => event.event === "Deployment Failed" || event.event === "Simulation Interrupted").at(-1);
  if (failure && run.status === "failed") {
    report.observed.push({ id: "failure", message: failure.message, sources: ["timeline"] });
    report.inspectNext.push("Start with the recorded failure message and original inputs before rerunning.");
  }
  const checkpoint = records.checkpoint;
  if (checkpoint) {
    if (checkpoint.health) report.observed.push({ id: "checkpoint-health",
      message: `The latest retained checkpoint records overall health as ${checkpoint.health}.`, sources: ["simulationState.overallHealth"] });
    for (const resource of checkpoint.resources) {
      if (resource.cpu !== undefined && resource.cpu >= 90) report.interpreted.push({ id: `cpu-headroom:${resource.id}`,
        message: `${resource.id} had at most 10 percentage points of CPU headroom at this checkpoint (${resource.cpu}%). This does not establish how long it stayed there.`,
        sources: [`simulationState.metrics.${resource.id}.cpu`] });
    }
    if (checkpoint.resources.some((r) => r.health && r.health !== "healthy")) report.inspectNext.push("Inspect the unhealthy checkpoint resources and their upstream connections; one snapshot cannot establish the cause.");
    report.unknown.push("The checkpoint has no retained capture timestamp. The run's updated time is not its measurement time, and measurements may predate the last controls or teardown.");
  } else report.unknown.push("No usable simulation checkpoint was retained. Final resource health, CPU, memory and accumulated cost are unknown.");
  if (!records.input) report.unknown.push("No usable immutable run input exists. The current saved design cannot establish what this deployment originally ran.");
  if (records.chaos.length) report.unknown.push("Chaos records show accepted requests, not proof of their full effect, causality, recovery or cost impact.");
  if (run.topologyRevision && report.topology.changes) report.interpreted.push({ id: "accepted-topology-diff",
    message: `Compared with the original input, resource changes in the last accepted topology are: ${report.topology.changes.added.length} added, ${report.topology.changes.removed.length} removed and ${report.topology.changes.reconfigured.length} reconfigured. Acceptance does not prove the simulator had applied that revision at the checkpoint.`,
    sources: ["runInputs", "liveTopology", "topologyRevision"] });
  report.unknown.push("A full historical telemetry series and intermediate topology revisions are not retained. Streamed scaling, restart, load and speed changes may be absent from this report.");
  report.unknown.push("Monthly estimates and checkpoint cost are educational model values, not cloud bills. A cost change caused by chaos cannot be established from these records.");
  report.inspectNext.push("Compare the recorded workload and original architecture, make one deliberate change, then rerun with the same workload to compare outcomes.");
  report.unknown = [...new Set(report.unknown)];
  return report;
}
