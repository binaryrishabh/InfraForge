import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { DatabaseMetricsSchema } from "../reports/databaseSchema";
import type { Topology } from "./criteria";

type Criterion = Extract<ChallengeCriterion, {kind: "stale-reads"}>;
export const staleReadsLimits = (c: Criterion) => Number.isSafeInteger(c.maxStaleReads) && c.maxStaleReads >= 0 && c.maxStaleReads <= 1_000_000;

/** Cumulative modeled reads served from a lagging replica, never a freshness guarantee or a latency claim. */
export function evaluateStaleReads(c: Criterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number) {
  const sources = ["runInputs.resources.databaseReplication", "terminalSnapshot.metrics.database.readRouting"];
  const unknown = (detail: string) => ({met: undefined, detail, sources});
  if (!staleReadsLimits(c) || !input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") return unknown("A captured design and current read-routing evidence at the exact evaluation second are required.");
  const owners = input.resources.filter(r => r.id === c.resourceId), owner = owners[0];
  if (owners.length !== 1 || owner?.type !== "Database" || owner.databaseReplication?.enabled !== true) return unknown("The named database with one enabled replica must be retained.");
  const rows = terminal.resources.filter(r => r.id === c.resourceId), parsed = DatabaseMetricsSchema.safeParse(rows[0]?.database);
  const routing = parsed.success ? parsed.data.readRouting : undefined;
  if (rows.length !== 1 || !routing) return unknown("Complete read-routing counters were not recorded; missing values stay Unknown.");
  return {met: routing.staleReads <= c.maxStaleReads, sources,
    detail: `Through second ${second}, ${c.resourceId} served ${routing.staleReads} stale reads (maximum ${c.maxStaleReads}); oldest missed commit age ${routing.maxStaleReadAgeMs} ms. Counters are cumulative, include health probes and describe modeled row versions only; they establish no application consistency or freshness guarantee.`};
}
