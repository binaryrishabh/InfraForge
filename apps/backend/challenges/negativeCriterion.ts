import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { cachePolicyError } from "@infraforge/domain/resource";
import type { Topology } from "./criteria";
import { CacheMetricsSchema } from "../reports/cacheSchema";

/** Source work per successful absent answer, including coalescing but never treating an error as absence. A zero-demand run cannot pass. */
export function evaluateNegativeCache(c: Extract<ChallengeCriterion, {kind:"cache-negative-load"}>, input: Topology | null, terminal: ReportCheckpoint | null, second: number, active: boolean, profiles?: readonly string[]): {met?:boolean;detail:string;sources:string[]} {
  const sources=["runInputs.resources", "runInputs.adapterProfiles", "terminalSnapshot.metrics.cache"];
  const unknown=(detail:string)=>({detail,sources});
  if(active || !input || !terminal || terminal.simulatedSeconds!==second || terminal.measurementFreshness!=="current-revision")return unknown("A completed run with current evidence at the exact evaluation second is required.");
  if(!profiles?.includes("cache-negative/1"))return unknown("The captured negative-cache profile was not recorded.");
  const caches=input.resources.filter(r=>r.id===c.resourceId && r.type==="Cache");
  const saved=caches[0]?.cachePolicy;
  if(caches.length!==1 || saved?.negativeTtlSeconds===undefined || cachePolicyError("Cache",saved))return unknown("The named cache must retain its valid saved negative-cache policy.");
  const rows=terminal.resources.filter(r=>r.id===c.resourceId);
  const parsed=rows.length===1?CacheMetricsSchema.safeParse(rows[0]!.cache):undefined;
  if(!parsed?.success)return unknown("Complete valid cache counters were not recorded.");
  const {absentAnswers,negativeHits,absentSourceReads,hits}=parsed.data;
  if(typeof absentAnswers!=="number" || typeof negativeHits!=="number" || typeof absentSourceReads!=="number" || typeof hits!=="number")return unknown("Successful absent answers, negative hits, empty source queries and hits must all be recorded.");
  if(negativeHits>absentAnswers || negativeHits>hits)return unknown("The negative-hit count contradicts the answer or cache-hit count.");
  if(absentAnswers===0)return {met:false,sources,detail:"No successful absent answer was recorded; a run without that demand cannot demonstrate reuse of an empty answer."};
  const ratio=absentSourceReads/absentAnswers;
  return {met:ratio<=c.maxSourceReadsPerAnswer,sources,detail:`Through second ${second}, ${c.resourceId}: ${absentSourceReads} empty source queries for ${absentAnswers} successful absent answers (${ratio.toFixed(4)} per answer; maximum ${c.maxSourceReadsPerAnswer}); ${negativeHits} answers came from cached absence. Source queries and answers are different populations when misses coalesce.`};
}
