import type { RunInputs } from "@infraforge/contracts/run-inputs";
import type { CompareMetric, ReportCheckpoint, ReportStatement } from "@infraforge/contracts/reports";
import { describeWorkloadVariantSource, requestsPerSecond } from "@infraforge/domain/workload";
import { fields } from "./design";
import { metric } from "./outcomes";

const statement = (id: string, message: string, sources: string[]): ReportStatement => ({id, message, sources});
export function workloadChangeFacts(a: RunInputs, b: RunInputs, strongest: boolean) {
  const descriptions: string[] = [];
  const left = describeWorkloadVariantSource(a.workloadProfile), right = describeWorkloadVariantSource(b.workloadProfile);
  if (left.arrivalProcess !== right.arrivalProcess) descriptions.push(`Arrival process: ${left.arrivalProcess} → ${right.arrivalProcess}`);
  const cv = (input: RunInputs) => input.workloadProfile.workloadDynamics?.applicationCpuCv ?? 0;
  if (cv(a) !== cv(b)) descriptions.push(`Application CPU variability: ${left.applicationCpuVariability} (CV ${cv(a)}) → ${right.applicationCpuVariability} (CV ${cv(b)})`);
  const labels: Record<string, string> = {targetThroughput: "Configured target throughput", throughputUnit: "Throughput unit", trafficShape: "Traffic shape",
    peakMultiplier: "Peak multiplier", readWriteRatio: "Read fraction", payloadSize: "Payload size", clientRetry: "Client retry settings", workloadObjective: "Service objective"};
  for (const difference of fields({...a.workloadProfile}, {...b.workloadProfile}).filter(d => d.field !== "workloadDynamics")) {
    descriptions.push(`${labels[difference.field] ?? difference.field}: ${JSON.stringify(difference.earlier)} → ${JSON.stringify(difference.later)}`);
  }
  if (!descriptions.length) descriptions.push(`Workload dynamics capture: ${JSON.stringify(a.workloadProfile.workloadDynamics) ?? "omitted"} → ${JSON.stringify(b.workloadProfile.workloadDynamics) ?? "omitted"} (resolved settings match)`);
  return {
    observed: [statement("workload-change", `${descriptions.join("; ")}. Matching recorded starting conditions: topology, resources and their settings, seed, model/catalog, adapter profiles and other workload fields.`, ["runInputs"])],
    interpreted: strongest ? [statement("workload-pair", `Within this pair, workload is the only recorded starting-input difference. For this seed, this simulated stop time and InfraForge model ${a.version === 2 ? a.simulationModelVersion : "Unknown"}, the observed differences followed that change. The same seed does not mean identical random draws or identical offered requests when the arrival process differs. Configured average rate is not the exact offered count of a finite Poisson sample. Another seed may differ.`, ["runInputs", "RunAction", "terminalSnapshot"])] : [],
    unknown: [statement("workload-pair", "This is one pair, one seed. It cannot establish statistical significance, general superiority, production reliability or real provider behavior; it is not a provider claim.", ["comparison.scope"])],
  };
}

function originalTotals(state: ReportCheckpoint | null | undefined): Array<number | undefined> {
  const whole = state?.traffic?.wholeRun, objective = state?.traffic?.objective;
  // These are exclusive caller outcomes, not dependency or retry attempt counts.
  if (whole && whole.throughSecond === state?.simulatedSeconds) {
    const failed = whole.failed + whole.deadlineExceeded + whole.abandoned;
    const offered = whole.completed + failed + whole.inFlight;
    return [Number.isSafeInteger(offered) ? offered : undefined, whole.completed, Number.isSafeInteger(failed) ? failed : undefined];
  }
  if (objective && objective.throughUs === (state?.simulatedSeconds ?? -1) * 1_000_000) {
    return [objective.offered, objective.good + objective.late, objective.failed + objective.deadlineExceeded + objective.abandoned];
  }
  return [undefined, undefined, undefined];
}

export function workloadChangeTraffic(a: RunInputs, b: RunInputs, earlier: ReportCheckpoint | null | undefined,
  later: ReportCheckpoint | null | undefined, exact: boolean): CompareMetric[] {
  const rows = [metric("Configured target rate (requests/s)", "requests/s", requestsPerSecond(a.workloadProfile), requestsPerSecond(b.workloadProfile), false,
    "Configured target rates describe starting inputs; observed original-request totals are recorded separately.")];
  const x = originalTotals(earlier), y = originalTotals(later);
  const sameDuration = earlier?.simulatedSeconds !== undefined && earlier.simulatedSeconds === later?.simulatedSeconds;
  ["Original requests offered, whole run", "Original requests completed, whole run", "Original requests failed (including deadline/abandonment), whole run"].forEach((field, i) => {
    const known = x[i] !== undefined && y[i] !== undefined;
    rows.push(metric(field, "requests", x[i], y[i], exact && sameDuration && known,
      !sameDuration ? "Different observation durations: whole-run totals are not comparable." : !exact ?
        "Exact final-state evidence is required for a delta." : "Whole-run original-request evidence is missing."));
  });
  return rows;
}
