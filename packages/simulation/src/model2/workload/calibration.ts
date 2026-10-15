import type { Quantity } from "../../reality/quantity";
import type { DemandProfile } from "./profiles";

export interface BenchmarkRecord {
  schema: "infraforge-benchmark/1";
  id: string;
  runId: string;
  split: "fit" | "holdout";
  application: string;
  operation: string;
  software: string;
  environment: string;
  date: string;
  provenance: string;
  configuration: Record<string, string>;
  warmupOperations: number;
  operations: number;
  cpuCoreUs: number;
  wallUs: number;
  cpuResolutionUs: number;
  measurement: "serial-batch-cpu";
  limitations: string[];
}
export function validateRecords(records: BenchmarkRecord[]) {
  if (!records.length || records.length > 10000) throw new Error("Benchmark record budget/empty input");
  const ids = new Set<string>(), fitRuns = new Set<string>(), holdoutRuns = new Set<string>();
  for (const r of records) {
    if (r.schema !== "infraforge-benchmark/1" || !r.id || ids.has(r.id) || !r.runId || !["fit", "holdout"].includes(r.split)) throw new Error("Invalid measurement schema/identity/split");
    ids.add(r.id); (r.split === "fit" ? fitRuns : holdoutRuns).add(r.runId);
    if ([r.application, r.operation, r.software, r.environment, r.provenance].some((s) => !s) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Object.keys(r.configuration).length || !r.limitations.length) throw new Error("Missing benchmark context/provenance");
    if (!Number.isSafeInteger(r.operations) || r.operations < 1 || !Number.isSafeInteger(r.warmupOperations) || r.warmupOperations < 0 || ![r.cpuCoreUs, r.wallUs, r.cpuResolutionUs].every((n) => Number.isFinite(n) && n > 0) || r.measurement !== "serial-batch-cpu") throw new Error("Invalid measurement/count/units");
    if (r.cpuCoreUs <= r.cpuResolutionUs) throw new Error("CPU measurement below stated resolution");
  }
  if ([...fitRuns].some((id) => holdoutRuns.has(id))) throw new Error("Fit/holdout run leakage");
}

export function fitConstantDemand(records: BenchmarkRecord[], contract: Omit<DemandProfile, "cpu" | "method" | "obtainedBy" | "evidence" | "uncertainty">, provenanceId: string) {
  validateRecords(records);
  const fit = records.filter((r) => r.split === "fit"), holdout = records.filter((r) => r.split === "holdout");
  if (fit.length < 2 || holdout.length < 2) throw new Error("At least two independent fitting and held-out batches required");
  const first = fit[0]!;
  for (const r of records) if (r.application !== contract.application || r.operation !== contract.operation || r.software !== first.software || r.environment !== first.environment || JSON.stringify(Object.entries(r.configuration).sort()) !== JSON.stringify(Object.entries(first.configuration).sort())) throw new Error("Incomparable benchmark records");
  if (contract.validity.exact.software !== first.software || contract.validity.exact.environment !== first.environment) throw new Error("Calibration validity must identify the measured software and environment");
  // Ratio estimator: aggregate measured core-time / aggregate completed operations.
  // No throughput or wall latency is relabelled as CPU service demand.
  const value = fit.reduce((n, r) => n + r.cpuCoreUs, 0) / fit.reduce((n, r) => n + r.operations, 0);
  const cpu: Quantity<"cpu-us"> = { kind: "known", unit: "cpu-us", value, provenance: [provenanceId] };
  const profile: DemandProfile = { ...contract, cpu, method: "fitted", obtainedBy: "Ratio of fitting-batch process CPU core-microseconds to completed operations; constant conditional mean", evidence: fit.map((r) => r.provenance),
    uncertainty: ["Candidate conditional mean, not a measured per-request constant or a universal throughput", "Observed batch range is descriptive, not a confidence interval", ...new Set(records.flatMap((r) => r.limitations))] };
  const evaluate = (rows: BenchmarkRecord[]) => {
    const relative = rows.map((r) => Math.abs(value - r.cpuCoreUs / r.operations) / (r.cpuCoreUs / r.operations));
    const errors = rows.map((r) => value - r.cpuCoreUs / r.operations);
    return { batches: rows.length, operations: rows.reduce((n, r) => n + r.operations, 0), maeCoreUs: errors.reduce((n, e) => n + Math.abs(e), 0) / rows.length,
      rmseCoreUs: Math.sqrt(errors.reduce((n, e) => n + e * e, 0) / rows.length), meanAbsoluteRelativeError: relative.reduce((n, e) => n + e, 0) / rows.length,
      maxAbsoluteRelativeError: Math.max(...relative), residualsCoreUs: errors };
  };
  return { schema: "infraforge-calibration/1", profile, fit: evaluate(fit), holdout: evaluate(holdout),
    fittingRecordIds: fit.map((r) => r.id), heldOutRecordIds: holdout.map((r) => r.id),
    observedFittingBatchMeanRangeCoreUs: { min: Math.min(...fit.map((r) => r.cpuCoreUs / r.operations)), max: Math.max(...fit.map((r) => r.cpuCoreUs / r.operations)) },
    acceptance: "candidate-only; no automatic activation or external-validity certification" };
}
