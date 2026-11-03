import type { RunSummary } from "@infraforge/contracts/reports";
import type { StatusKind } from "@/ui/status";

export function runStatus(status: string): { kind: StatusKind; label: string } {
  if (status === "live") return { kind: "in-progress", label: "Live" };
  if (status === "pending" || status === "running") return { kind: "pending", label: "Starting" };
  if (status === "failed") return { kind: "failed", label: "Failed" };
  if (status === "torn-down" || status === "completed") return { kind: "finished", label: status === "torn-down" ? "Stopped" : "Completed" };
  return { kind: "unknown", label: status };
}

export const RERUN_LABEL = { exact: "Exact rerun", "current-design": "Rerun, current design", "workload-variant": "Traffic experiment" } as const;

// How a run's lineage reads in the live panel, ending where the link to the source run begins.
export const RERUN_SENTENCE = { exact: "Exact rerun of", "current-design": "Rerun with the current design of",
  "workload-variant": "Traffic experiment: the same captured design and seed as" } as const;
export const RERUN_SUFFIX = { exact: "", "current-design": "", "workload-variant": ", with one traffic setting changed" } as const;

export function runKind(run: RunSummary) {
  if (run.challenge) return { label: "Challenge attempt", detail: run.challenge.title };
  if (run.sourceRunId) return { label: RERUN_LABEL[run.rerunMode ?? "current-design"], detail: `of ${run.sourceRunName ?? "a retained source run"}` };
  return { label: "Freeform run", detail: null };
}
