import type { RunAction as StoredAction } from "../lib/generated/prisma/client";
import { actionDto } from "../actions/contract";

export function readReportActions(rows: StoredAction[] | undefined, limits: string[]) {
  if (!rows) return [];
  const sorted = [...rows].sort((a, b) => a.sequence - b.sequence);
  if (sorted.length > 500) limits.push("Only the latest 500 durable actions are shown; earlier steps are omitted.");
  return sorted.slice(-500).flatMap((row) => {
    try { return [actionDto(row)]; }
    catch { limits.push("A malformed durable action was omitted; its outcome cannot be established."); return []; }
  });
}
