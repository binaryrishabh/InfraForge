import type { RunRecord } from "@infraforge/contracts/reports";
import { buildRunReport, type StoredRun } from "../reports/report";
import { readRunInputs } from "../deployments/runInputs";
import { readRunRecord } from "./schema";
import { model1Availability, historicalExecutionPolicy, type HistoricalExecutionPolicy } from "./availability";

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
