import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import type { Topology } from "./criteria";
import { CacheMetricsSchema } from "../reports/cacheSchema";

export type FreshCriterion = Extract<ChallengeCriterion, {kind: "cache-fresh-reads"}>;

/** Cache hits that were behind the database's committed version, counted only when the cache's write policy was saved. A cache with no hits, or with missing or malformed counters, is never a pass. */
export function evaluateFreshReads(c: FreshCriterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number, active: boolean): {met?: boolean; detail: string; sources: string[]} {
  const sources = ["runInputs.resources", "terminalSnapshot.metrics.cache"];
  const unknown = (detail: string) => ({detail, sources});
  if (active || !input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") return unknown("A completed run with a current terminal measurement at the exact evaluation second is required.");
  const caches = input.resources.filter(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.Cache);
  if (caches.length !== 1) return unknown("The named cache must be retained in the captured design.");
  const invalidates = caches[0]!.cachePolicy?.invalidateOnWrite;
  if (typeof invalidates !== "boolean") return unknown("Freshness is recorded only when the cache's write policy is saved; it is not saved on the captured design.");
  const rows = terminal.resources.filter(r => r.id === c.resourceId);
  const parsed = rows.length === 1 ? CacheMetricsSchema.safeParse(rows[0]!.cache) : undefined;
  if (!parsed?.success) return unknown("Complete valid cache counters were not recorded.");
  const {hits, outdatedHits: behind, maxVersionsBehind: gap} = parsed.data;
  if (typeof hits !== "number") return unknown("The cache hit count was not recorded.");
  if (typeof behind !== "number") return unknown("The count of hits behind the database was not recorded.");
  if (typeof gap !== "number") return unknown("The largest version gap behind the database was not recorded.");
  if (behind > hits) return unknown("The recorded freshness counters contradict the hit count.");
  return {met: behind <= c.maxOutdatedHits && hits >= c.minHits, sources,
    detail: `Through second ${second}, ${c.resourceId} (invalidate on write ${invalidates ? "on" : "off"}): ${behind} of ${hits} hits were behind the database (maximum ${c.maxOutdatedHits}; at least ${c.minHits} hits required), most ${gap} version${gap === 1 ? "" : "s"} behind.`};
}
