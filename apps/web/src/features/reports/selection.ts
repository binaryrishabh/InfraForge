import type { RunSummary } from "@infraforge/contracts/reports";
export function selectionReason(run: RunSummary) {
  return ["pending", "running", "live"].includes(run.status) ? "Stop this run or wait for gates before comparing." : null;
}
export function toggleRun(selected: string[], id: string) {
  return selected.includes(id) ? selected.filter((x) => x !== id) : selected.length < 2 ? [...selected, id] : selected;
}
