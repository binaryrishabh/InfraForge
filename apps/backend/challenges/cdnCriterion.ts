import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import type { Topology } from "./criteria";
import { CdnMetricsSchema } from "../reports/cdnSchema";

export type CdnCriterion = Extract<ChallengeCriterion, {kind: "cdn-origin-load"}>;

/** Cumulative origin requests for one CDN, valid only while its retained freshness setting stays within the stated bound. Missing evidence stays Unknown. */
export function evaluateCdnOriginLoad(c: CdnCriterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number, active: boolean): {met?: boolean; detail: string; sources: string[]} {
  const sources = ["runInputs.resources", "terminalSnapshot.metrics.cdn"];
  const unknown = (detail: string) => ({detail, sources});
  if (active || !input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") return unknown("A completed run with a current terminal measurement at the exact evaluation second is required.");
  const cdns = input.resources.filter(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.CDN);
  if (cdns.length !== 1) return unknown("The named CDN must be retained in the captured design.");
  const ttl = cdns[0]!.cdnCachePolicy?.ttlSeconds;
  if (typeof ttl !== "number") return unknown("The CDN's saved freshness (TTL) must be retained in the captured design.");
  const rows = terminal.resources.filter(r => r.id === c.resourceId);
  const parsed = rows.length === 1 ? CdnMetricsSchema.safeParse(rows[0]!.cdn) : undefined;
  if (!parsed?.success) return unknown("Complete valid CDN counters were not recorded.");
  const origin = parsed.data.originRequests;
  if (typeof origin !== "number") return unknown("The CDN origin request count was not recorded.");
  return {met: origin <= c.maxOriginRequests && ttl <= c.maxTtlSeconds, sources,
    detail: `Through second ${second}, ${c.resourceId}: ${origin} origin requests (maximum ${c.maxOriginRequests}) with a ${ttl}-second TTL (maximum ${c.maxTtlSeconds}).`};
}
