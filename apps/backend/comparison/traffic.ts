import type { CompareMetric, ReportCheckpoint } from "@infraforge/contracts/reports";
import { metric } from "./outcomes";

// Missing blocks and unknown values have no comparable row. The snapshots may
// be diagnostic; only available exact terminal pairs permit final-state deltas.
export function compareTraffic(a: ReportCheckpoint | null | undefined, b: ReportCheckpoint | null | undefined, allowed: boolean): CompareMetric[] {
  const earlier = a?.traffic, later = b?.traffic;
  if (!earlier || !later) return [];
  const rows: CompareMetric[] = [];
  const add = (field: string, unit: string, x: number | null | undefined, y: number | null | undefined) => {
    if (x != null && y != null) rows.push(metric(field, unit, x, y, allowed));
  };
  for (const p of ["p50", "p95", "p99"] as const) {
    add(`${p} response time, last measured second`, "ms", earlier.latencyMs[p], later.latencyMs[p]);
  }
  add("Completed requests/s, last measured second", "requests/s", earlier.completedRps, later.completedRps);
  add("Failed requests/s, last measured second", "requests/s", earlier.failedRps, later.failedRps);
  add("Client retry load factor, whole run", "attempts/original", earlier.clientRetry?.extraLoadFactor, later.clientRetry?.extraLoadFactor);
  const percent = (value: number | null | undefined) => value == null ? undefined : value * 100;
  add("Objective: requests in time, worst-case % (whole run)", "%", percent(earlier.objective?.worstCaseFraction), percent(later.objective?.worstCaseFraction));
  add("Objective: requests in time, best-case % (whole run)", "%", percent(earlier.objective?.bestCaseFraction), percent(later.objective?.bestCaseFraction));
  add("Timed-out attempts, whole run", "attempts", earlier.clientRetry?.attemptsTimedOut, later.clientRetry?.attemptsTimedOut);
  return rows;
}
