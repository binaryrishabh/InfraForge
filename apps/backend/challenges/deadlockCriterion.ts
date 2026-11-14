import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import type { Topology } from "./criteria";
import { DatabaseMetricsSchema } from "../reports/databaseSchema";

export type DeadlockCriterion = Extract<ChallengeCriterion, {kind: "database-deadlocks"}>;

/** Deadlock cycles the database found, counted only when the saved row lock order was recorded. Missing, null or contradictory counters are never a pass. */
export function evaluateDeadlocks(c: DeadlockCriterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number, active: boolean): {met?: boolean; detail: string; sources: string[]} {
  const sources = ["runInputs.resources", "terminalSnapshot.metrics.database"];
  const unknown = (detail: string) => ({detail, sources});
  if (active || !input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") return unknown("A completed run with a current terminal measurement at the exact evaluation second is required.");
  const databases = input.resources.filter(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.Database);
  if (databases.length !== 1) return unknown("The named database must be retained in the captured design.");
  const order = databases[0]!.rowLocking?.order;
  if (order !== "as-requested" && order !== "by-key") return unknown("Deadlocks are recorded only when the database's row lock order is saved; it is not saved on the captured design.");
  const rows = terminal.resources.filter(r => r.id === c.resourceId);
  const parsed = rows.length === 1 ? DatabaseMetricsSchema.safeParse(rows[0]!.database) : undefined;
  if (!parsed?.success) return unknown("Complete valid database counters were not recorded.");
  const {deadlocks, lockWaits, deadlockVictims} = parsed.data;
  if (typeof deadlocks !== "number") return unknown("The deadlock count was not recorded.");
  if (typeof lockWaits !== "number") return unknown("The row-lock wait count was not recorded.");
  if (typeof deadlockVictims !== "number") return unknown("The deadlock victim count was not recorded.");
  if (deadlockVictims !== deadlocks || deadlocks > lockWaits) return unknown("The recorded lock counters contradict each other.");
  return {met: deadlocks <= c.maxDeadlocks, sources,
    detail: `Through second ${second}, ${c.resourceId} (row lock order ${order === "by-key" ? "by key" : "as requested"}): ${deadlocks} deadlock${deadlocks === 1 ? "" : "s"} found (maximum ${c.maxDeadlocks}), ${deadlockVictims} transaction${deadlockVictims === 1 ? "" : "s"} ended as ${deadlockVictims === 1 ? "its" : "their"} victim${deadlockVictims === 1 ? "" : "s"}, ${lockWaits} row-lock wait${lockWaits === 1 ? "" : "s"}.`};
}
