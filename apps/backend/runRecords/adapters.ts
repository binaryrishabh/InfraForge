import type { RunRecord } from "@infraforge/contracts/reports";
import { buildRunReport, type StoredRun } from "../reports/report";
import { readRunInputs } from "../deployments/runInputs";
import { internalReport } from "../internalModel2/report";
import { readEnvelope } from "../internalModel2/envelope";
import type { InternalRunRow } from "../internalModel2/store";
import { requireKnown } from "@infraforge/simulation/internal-product";
import { readRunRecord } from "./schema";
import { model1Availability, historicalExecutionPolicy, type HistoricalExecutionPolicy } from "./availability";
export { firstStackRunRecord } from "./firstStack";

export function model1RunRecord(row: StoredRun, policy: HistoricalExecutionPolicy = historicalExecutionPolicy): RunRecord {
  const report = buildRunReport(row);
  let input: ReturnType<typeof readRunInputs> | null = null;
  try { input = readRunInputs(row.runInputs); } catch { /* Historical absence stays explicit. */ }
  return readRunRecord({ schema: "infraforge-run-record/1", id: row.id, designId: row.infrastructureId, status: row.status,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    engine: { lineage: "1", version: input?.version === 2 ? input.simulationModelVersion : null, source: null },
    experiment: { inputSchema: input ? `infraforge-run-inputs/${input.version}` : null, input,
      horizonSeconds: row.autoStopAtSimulatedSeconds ?? row.evaluationStopAtSimulatedSeconds ?? null },
    evidence: { reportSchema: "infraforge-run-report/1", report, unknown: report.unknown },
    reference: { engine: "1", store: "Deployment", id: row.id }, availability: model1Availability(input, policy),
    ...(row.challengeId ? { learning: { kind: "challenge", profile: row.challengeVersion == null ? null : `${row.challengeId}/${row.challengeVersion}`,
      ...(row.challengePrediction == null ? {} : { prediction: row.challengePrediction }) } } : {}) });
}

export function model2RunRecord(row: InternalRunRow, lessonProfile?: string): RunRecord {
  const report = internalReport(row);
  let input: ReturnType<typeof readEnvelope> | null = null;
  try { input = readEnvelope(row.input, row.inputHash, false); } catch { /* Reading never recompiles old evidence. */ }
  return readRunRecord({ schema: "infraforge-run-record/1", id: row.id, designId: row.infrastructureId, status: row.status,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    engine: { lineage: "2", version: input?.contract.version ?? null, source: report.source },
    experiment: { inputSchema: input?.schema ?? null, input, horizonSeconds: input ? requireKnown(input.contract.horizon, "us") / 1_000_000 : null },
    evidence: { reportSchema: report.schema, report, unknown: [...report.unknown, ...report.problems] },
    reference: { engine: "2", store: "InternalModel2Run", id: row.id },
    availability: { report: report.inputValid && report.state ? "readable" : "partial", execution: "unavailable",
      replay: report.replay.compatible ? "available" : "unavailable", reasons: [report.replay.reason, ...report.problems] },
    ...(lessonProfile === undefined ? {} : { learning: { kind: "lesson", profile: lessonProfile } }) });
}
