import type { RunSummary } from "@infraforge/contracts/reports";
import type { StatusKind } from "@/ui/status";

export function runStatus(status: string): { kind: StatusKind; label: string } {
  if (status === "live") return { kind: "in-progress", label: "Live" };
  if (status === "pending" || status === "running") return { kind: "pending", label: "Starting" };
  if (status === "failed") return { kind: "failed", label: "Failed" };
  if (status === "torn-down" || status === "completed") return { kind: "finished", label: status === "torn-down" ? "Stopped" : "Completed" };
  return { kind: "unknown", label: status };
}

export function runKind(run: RunSummary) {
  if (run.challenge) return { label: "Challenge attempt", detail: run.challenge.title };
  if (run.sourceRunId) return { label: run.rerunMode === "exact" ? "Exact rerun" : "Rerun, current design", detail: `of ${run.sourceRunName ?? "a retained source run"}` };
  return { label: "Freeform run", detail: null };
}
