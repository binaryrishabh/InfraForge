import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { defaultApiRoutes } from "@infraforge/domain/resource";
import { GatewayMetricsSchema } from "../reports/newResourceSchema";
import { SchedulerMetricsSchema } from "../reports/schedulerSchema";
import { ServerlessMetricsSchema } from "../reports/serverlessSchema";
import type { Topology } from "./criteria";

export type DepthCriterion = Extract<ChallengeCriterion, {kind: "gateway-route-work" | "scheduler-work" | "function-work"}>;
export const isDepthCriterion = (c: ChallengeCriterion): c is DepthCriterion => ["gateway-route-work", "scheduler-work", "function-work"].includes(c.kind);
export const depthResourceType = (c: DepthCriterion) => c.kind === "gateway-route-work" ? "API Gateway" : c.kind === "scheduler-work" ? "Scheduler" : "Serverless Function";
export function depthCriterionLimits(c: DepthCriterion): boolean {
  const limits = c.kind === "gateway-route-work" ? [c.maxUpstreamFailed] : c.kind === "scheduler-work" ? [c.maxMissed, c.maxOutstanding] : [c.maxThrottled, c.maxDownstreamFailed];
  return Number.isSafeInteger(c.minCompleted) && c.minCompleted > 0 && limits.every(n => Number.isSafeInteger(n) && n >= 0);
}

// Counts cover the run from start through this checkpoint. Older captures may
// omit resource counters or route outcomes; absence cannot satisfy a budget.
export function evaluateDepthCriterion(c: DepthCriterion, input: Topology | null, terminal: ReportCheckpoint | null): {met?: boolean; detail: string; sources: string[]} {
  const sources = ["runInputs.resources", `terminalSnapshot.metrics.${c.kind === "gateway-route-work" ? "gateway" : c.kind === "scheduler-work" ? "scheduler" : "serverless"}`];
  const unknown = (detail: string) => ({detail, sources});
  if (!input || !terminal || terminal.measurementFreshness !== "current-revision") return unknown("A current evaluation checkpoint and captured design are required.");
  const targets = input.resources.filter(r => r.id === c.resourceId && r.type === depthResourceType(c));
  const rows = terminal.resources.filter(r => r.id === c.resourceId);
  if (targets.length !== 1 || rows.length !== 1) return unknown("The named resource and its unique measurements must be retained; no replacement is inferred.");
  const prefix = `Through second ${terminal.simulatedSeconds}, ${c.resourceId}`;
  if (c.kind === "gateway-route-work") {
    const parsed = GatewayMetricsSchema.safeParse(rows[0]!.gateway);
    if (!parsed.success) return unknown("Complete gateway budget counters were not recorded.");
    const expected = targets[0]!.apiGateway?.routes ?? defaultApiRoutes(input.connectionLines.filter(e => e.sourceId === c.resourceId).sort((a, b) => a.id < b.id ? -1 : 1));
    const g = parsed.data;
    if (expected.length !== g.routes.length || !expected.every(e => g.routes.some(r => r.id === e.id && r.path === e.path && r.method === e.method && input.connectionLines.some(edge => edge.id === e.edge && edge.sourceId === c.resourceId && edge.targetId === r.target)))) return unknown("Gateway measurements do not match the captured route bindings.");
    const route = g.routes.find(r => r.id === c.routeId), o = route?.outcomes;
    if (!route || !o) return unknown("The named route's completed and failed upstream outcomes are Unknown.");
    return {met: o.completed >= c.minCompleted && o.upstreamFailed <= c.maxUpstreamFailed, sources,
      detail: `${prefix}/${c.routeId}: ${o.completed} completions (minimum ${c.minCompleted}), ${o.upstreamFailed} upstream failures (maximum ${c.maxUpstreamFailed}); ${route.admitted} admitted, ${route.rejected} rate refusals, ${o.overloaded} shared-capacity refusals, ${o.pending} pending. Independent route tokens do not reserve shared execution capacity.`};
  }
  if (c.kind === "scheduler-work") {
    const parsed = SchedulerMetricsSchema.safeParse(rows[0]!.scheduler);
    if (!parsed.success || !parsed.data.attemptAccounting) return unknown("Complete scheduler invocation and attempt accounting was not recorded.");
    const s = parsed.data, a = s.attemptAccounting!, outstanding = s.active + s.queued + s.retainedLatest;
    return {met: s.completed >= c.minCompleted && s.missed <= c.maxMissed && outstanding <= c.maxOutstanding, sources,
      detail: `${prefix}: ${s.due} due, ${s.completed} completed (minimum ${c.minCompleted}), ${s.missed} missed (maximum ${c.maxMissed}), ${outstanding} outstanding (maximum ${c.maxOutstanding}); ${s.failed} failed, ${s.skippedOverlap} skipped overlaps, ${s.retried} retries; ${a.delayedStarts} delayed starts, maximum start delay ${a.maxStartDelayUs / 1000} ms, peak active ${s.peakActive}, peak queued ${s.peakQueued}.`};
  }
  const parsed = ServerlessMetricsSchema.safeParse(rows[0]!.serverless);
  if (!parsed.success || !parsed.data.lifecycle) return unknown("Complete function ownership and lifecycle counters were not recorded.");
  const f = parsed.data;
  const outputs = input.connectionLines.filter(e => e.sourceId === c.resourceId);
  if (outputs.length !== 1 || !input.resources.some(r => r.id === outputs[0]!.targetId && r.type === "Database") || f.downstreamCalls < f.completed) return unknown("The captured function database path and successful downstream work must be retained.");
  return {met: f.completed >= c.minCompleted && f.throttled <= c.maxThrottled && f.downstreamFailed <= c.maxDownstreamFailed, sources,
    detail: `${prefix}: ${f.completed} completed (minimum ${c.minCompleted}), ${f.throttled} throttled (maximum ${c.maxThrottled}), ${f.downstreamFailed} downstream failures (maximum ${c.maxDownstreamFailed}); ${f.coldStarts} cold, ${f.warmStarts} warm starts, ${f.downstreamCalls} database calls, ${f.active} active. Database pools are shared per source, not per warm instance.`};
}
