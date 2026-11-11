import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import type { Topology } from "./criteria";
import { CacheMetricsSchema } from "../reports/cacheSchema";

export type StaleCriterion = Extract<ChallengeCriterion, {kind: "cache-stale-answers"}>;

/** Stale answers actually served inside a saved bound, with normal freshness (TTL) kept. Missing evidence stays Unknown; a stale answer is never counted as fresh. */
export function evaluateStaleAnswers(c: StaleCriterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number, active: boolean): {met?: boolean; detail: string; sources: string[]} {
  const sources = ["runInputs.resources", "terminalSnapshot.metrics.cache"];
  const unknown = (detail: string) => ({detail, sources});
  if (active || !input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") return unknown("A completed run with a current terminal measurement at the exact evaluation second is required.");
  const caches = input.resources.filter(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.Cache);
  if (caches.length !== 1) return unknown("The named cache must be retained in the captured design.");
  const policy = caches[0]!.cachePolicy, ttl = policy?.ttlSeconds, bound = policy?.staleSeconds;
  if (typeof ttl !== "number") return unknown("The cache's saved TTL must be retained in the captured design.");
  if (typeof bound !== "number") return {met: false, sources, detail: `No stale age bound is saved on ${c.resourceId}, so no stale answer can be served; TTL ${ttl} s.`};
  const rows = terminal.resources.filter(r => r.id === c.resourceId);
  const parsed = rows.length === 1 ? CacheMetricsSchema.safeParse(rows[0]!.cache) : undefined;
  if (!parsed?.success) return unknown("Complete valid cache counters were not recorded.");
  const served = parsed.data.staleServed, oldest = parsed.data.maxStaleAgeUs;
  if (typeof served !== "number") return unknown("The count of stale answers was not recorded.");
  if (served > 0 && typeof oldest !== "number") return unknown("The oldest stale answer age was not recorded.");
  const ageOk = oldest == null || oldest <= c.maxStaleAgeSeconds * 1_000_000;
  return {met: served >= c.minStaleServed && ageOk && ttl <= c.maxTtlSeconds && bound <= c.maxStaleAgeSeconds, sources,
    detail: `Through second ${second}, ${c.resourceId}: ${served} stale answers (minimum ${c.minStaleServed}), oldest ${oldest == null ? "none served" : `${(oldest / 1e6).toFixed(1)} s`} (maximum ${c.maxStaleAgeSeconds} s); TTL ${ttl} s (maximum ${c.maxTtlSeconds} s), stale bound ${bound} s.`};
}
