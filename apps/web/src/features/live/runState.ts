import type { Deployment } from "@infraforge/contracts/deployment";
import type { StatusKind } from "@/ui/status";

export type RunPhase = "starting" | "live" | "stopping" | "finished" | "failed" | "connection";

export function runPhase(status: string, stopping: boolean): RunPhase {
  if (status === "Web Socket connection error") return "connection";
  if (status === "failed") return "failed";
  if (status === "torn-down" || status === "completed") return "finished";
  if (stopping) return "stopping";
  return status === "live" ? "live" : "starting";
}

export const PHASE: Record<RunPhase, { label: string; kind: StatusKind }> = {
  starting: { label: "Starting", kind: "pending" },
  live: { label: "Live", kind: "in-progress" },
  stopping: { label: "Stopping", kind: "pending" },
  finished: { label: "Finished", kind: "met" },
  failed: { label: "Failed", kind: "not-met" },
  connection: { label: "Reconnecting", kind: "unknown" },
};

// The simulated second at which this run stops by itself, and why.
export function stopTarget(run: Deployment | null): { seconds: number; reason: "evaluation" | "matched-stop" } | null {
  if (run?.evaluationStopAtSimulatedSeconds != null) return { seconds: run.evaluationStopAtSimulatedSeconds, reason: "evaluation" };
  if (run?.autoStopAtSimulatedSeconds != null) return { seconds: run.autoStopAtSimulatedSeconds, reason: "matched-stop" };
  return null;
}
