import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import type { Topology } from "./criteria";
import { EventBusMetricsSchema } from "../reports/newResourceSchema";

export type BusCriterion = Extract<ChallengeCriterion, {kind: "bus-dead-letters"}>;

/** Cumulative dead-letter retention for one bus at the exact evaluation second. Missing or inconsistent evidence stays Unknown. */
export function evaluateBusDeadLetters(c: BusCriterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number, active: boolean): {met?: boolean; detail: string; sources: string[]} {
  const sources = ["runInputs.resources", "terminalSnapshot.metrics.eventBus"];
  const unknown = (detail: string) => ({detail, sources});
  if (active || !input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") return unknown("A completed run with a current terminal measurement at the exact evaluation second is required.");
  if (input.resources.filter(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.EventBus).length !== 1) return unknown("The named event bus must be retained in the captured design.");
  const rows = terminal.resources.filter(r => r.id === c.resourceId);
  const parsed = rows.length === 1 ? EventBusMetricsSchema.safeParse(rows[0]!.eventBus) : undefined;
  if (!parsed?.success) return unknown("Complete valid event bus counters were not recorded.");
  const kept = parsed.data.subscriptions.reduce((n, s) => n + s.deadLettered, 0), lost = parsed.data.subscriptions.reduce((n, s) => n + s.deadLetterOverflow, 0);
  return {met: kept >= c.minDeadLettered && lost === 0, sources,
    detail: `Through second ${second}, ${c.resourceId}: ${kept} dead-lettered (minimum ${c.minDeadLettered}) and ${lost} discarded because the dead-letter list was full (maximum 0).`};
}
