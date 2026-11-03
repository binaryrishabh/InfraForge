import type { CompareMetric, ReportCheckpoint } from "@infraforge/contracts/reports";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { metric } from "./outcomes";

type Traffic = NonNullable<ReportCheckpoint["traffic"]>;
type Input = RunInputs | null | undefined;
const SIDES = ["earlier", "later"] as const;

// Why a measurement can be missing from one run, from what that run recorded and what its inputs asked for.
// Only reasons the evidence supports are given; otherwise the row says it was not recorded.
const reasons = {
  traffic: () => "Traffic outcomes were not recorded for that run.",
  // "Off" is only said when the run's own inputs show it; with no inputs the evidence is simply not recorded.
  retry: (input: Input) => input && !input.workloadProfile.clientRetry ? "Client retries were off in that run." : "Client retry measurements were not recorded for that run.",
  objective: (input: Input) => input && !input.workloadProfile.workloadObjective ? "No service objective was set in that run." : "The service objective was not recorded for that run.",
  wholeRun: (input: Input) => input?.version === 2 && !input.adapterProfiles?.includes("traffic-evidence/2")
    ? "That run was captured before whole-run percentiles were recorded." : "Whole-run percentiles were not recorded for that run.",
  percentile: () => "Too few requests completed in that run for this percentile.",
  lastSecond: () => "This measurement is Unknown for that run.",
  unknown: () => "This measurement is Unknown for that run.",
};

// Evidence recorded in both runs is compared. Evidence recorded in only one run gets a row saying so, with the
// other side left Unknown, never zero. Evidence neither run recorded has no row. The snapshots may be diagnostic;
// only available exact terminal pairs permit final-state deltas.
export function compareTraffic(a: ReportCheckpoint | null | undefined, b: ReportCheckpoint | null | undefined, allowed: boolean,
  inputs: [Input, Input] = [undefined, undefined]): CompareMetric[] {
  const traffic: [Traffic | undefined, Traffic | undefined] = [a?.traffic, b?.traffic];
  if (!traffic[0] && !traffic[1]) return [];
  const rows: CompareMetric[] = [];
  const add = (field: string, unit: string, values: [number | null | undefined, number | null | undefined],
    why: (side: 0 | 1) => string) => {
    const [x, y] = values;
    if (x == null && y == null) return;
    if (x != null && y != null) { rows.push(metric(field, unit, x, y, allowed)); return; }
    const missing: 0 | 1 = x == null ? 0 : 1;
    // A run with no traffic block at all is the broader reason; otherwise the specific evidence is what is missing.
    const reason = traffic[missing] ? why(missing) : reasons.traffic();
    rows.push(metric(field, unit, x ?? undefined, y ?? undefined, false,
      `Recorded for the ${SIDES[1 - missing]} run but not the ${SIDES[missing]} run. ${reason} A direct comparison is unavailable.`));
  };
  const both = <T,>(read: (t: Traffic) => T): [T | undefined, T | undefined] => [traffic[0] && read(traffic[0]), traffic[1] && read(traffic[1])];
  for (const p of ["p50", "p95", "p99"] as const) {
    add(`${p} response time, last measured second`, "ms", both(t => t.latencyMs[p]), reasons.lastSecond);
  }
  for (const p of ["p50", "p95", "p99"] as const) {
    add(`${p} response time, whole run (upper bucket bound, within 3%)`, "ms", both(t => t.wholeRun?.percentiles[p]?.highMs),
      side => traffic[side]?.wholeRun ? reasons.percentile() : reasons.wholeRun(inputs[side]));
  }
  add("Completed requests/s, last measured second", "requests/s", both(t => t.completedRps), reasons.lastSecond);
  add("Failed requests/s, last measured second", "requests/s", both(t => t.failedRps), reasons.lastSecond);
  const retryWhy = (side: 0 | 1) => traffic[side]?.clientRetry ? reasons.unknown() : reasons.retry(inputs[side]);
  const objectiveWhy = (side: 0 | 1) => traffic[side]?.objective ? reasons.unknown() : reasons.objective(inputs[side]);
  add("Client retry load factor, whole run", "attempts/original", both(t => t.clientRetry?.extraLoadFactor), retryWhy);
  const percent = (value: number | null | undefined) => value == null ? undefined : value * 100;
  add("Objective: requests in time, worst-case % (whole run)", "%", both(t => percent(t.objective?.worstCaseFraction)), objectiveWhy);
  add("Objective: requests in time, best-case % (whole run)", "%", both(t => percent(t.objective?.bestCaseFraction)), objectiveWhy);
  add("Timed-out attempts, whole run", "attempts", both(t => t.clientRetry?.attemptsTimedOut), retryWhy);
  return rows;
}
