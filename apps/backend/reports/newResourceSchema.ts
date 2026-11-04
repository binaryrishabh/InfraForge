import { z } from "zod";
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(256);
const deliveryAccounting = z.object({ attempts: count, failedAttempts: count, exhausted: count }).strict();
const subscription = z.object({ id, target: id, accepted: count, delivered: count, retried: count, discarded: count, filtered: count, pending: count, deadLettered: count, deadLetterOverflow: count, deliveryAccounting: deliveryAccounting.optional() }).strict();
export const EventBusMetricsSchema = z.object({ version: z.literal(1), accepted: count, invalid: count, subscriptions: z.array(subscription).min(1).max(16) }).strict().superRefine((bus, ctx) => {
  if (new Set(bus.subscriptions.map(s => s.id)).size !== bus.subscriptions.length) ctx.addIssue({ code: "custom", message: "Duplicate subscription evidence" });
  for (const s of bus.subscriptions) {
    const fullDiscards = bus.accepted - s.filtered - s.accepted, terminalDiscards = s.discarded - fullDiscards;
    if (fullDiscards < 0 || terminalDiscards < 0 || s.accepted !== s.delivered + s.pending + s.deadLettered + terminalDiscards || s.deadLetterOverflow > terminalDiscards) ctx.addIssue({ code: "custom", message: "Inconsistent subscription ownership counters" });
    const a = s.deliveryAccounting;
    if (a && (a.exhausted !== s.deadLettered + s.deadLetterOverflow || a.failedAttempts < a.exhausted || a.attempts < s.delivered + a.failedAttempts || a.attempts > s.delivered + a.failedAttempts + s.pending || a.attempts - s.retried > s.accepted || a.attempts - s.retried < s.delivered + a.exhausted)) ctx.addIssue({ code: "custom", message: "Inconsistent delivery attempt counters" });
  }
});
const outcomes = z.object({ matched: count, overloaded: count, completed: count, gatewayFailed: count, upstreamFailed: count, timedOut: count, cancelled: count, pending: count, settled: count, totalDurationUs: count, maxDurationUs: count }).strict();
const route = z.object({ id, target: id, path: z.string().min(1).max(256), method: z.enum(["GET", "POST", "ANY"]), received: count, admitted: count, rejected: count, tokens: count, capacity: count.max(10000), outcomes: outcomes.optional() }).strict();
export const GatewayMetricsSchema = z.object({ version: z.literal(1), received: count, admitted: count, completed: count, invalid: count, missingRoute: count, throttled: count, overloaded: count, gatewayFailed: count, upstreamFailed: count, timedOut: count, cancelled: count, pending: count, routes: z.array(route).min(1).max(16) }).strict().superRefine((g, ctx) => {
  if (new Set(g.routes.map(r => r.id)).size !== g.routes.length || g.received !== g.admitted + g.invalid + g.missingRoute + g.throttled + g.overloaded || g.admitted !== g.completed + g.pending + g.gatewayFailed + g.upstreamFailed + g.timedOut + g.cancelled || g.routes.reduce((n, r) => n + r.admitted, 0) !== g.admitted || g.routes.reduce((n, r) => n + r.rejected, 0) !== g.throttled || g.routes.some(r => r.received !== r.admitted + r.rejected || r.tokens > r.capacity)) ctx.addIssue({ code: "custom", message: "Inconsistent gateway ownership or budget counters" });
  for (const r of g.routes) {
    const o = r.outcomes;
    if (o && (o.matched !== r.received + o.overloaded || o.settled !== o.completed + o.gatewayFailed + o.upstreamFailed + o.timedOut + o.cancelled || r.admitted !== o.settled + o.pending || o.maxDurationUs > o.totalDurationUs || (o.settled === 0 ? o.totalDurationUs !== 0 : o.totalDurationUs / o.settled > o.maxDurationUs))) ctx.addIssue({ code: "custom", message: "Inconsistent route outcomes or duration" });
  }
  if (g.routes.some(r => r.outcomes)) {
    for (const key of ["overloaded", "completed", "gatewayFailed", "upstreamFailed", "timedOut", "cancelled", "pending"] as const) {
      if (g.routes.some(r => !r.outcomes) || g.routes.reduce((n, r) => n + (r.outcomes?.[key] ?? 0), 0) !== g[key]) ctx.addIssue({ code: "custom", message: "Route outcomes must reconcile with gateway totals" });
    }
  }
});
