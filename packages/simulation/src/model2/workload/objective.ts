import type { CallerOutcome } from "./contracts";

export function classifyObjective(outcome: CallerOutcome, responseUs: number, thresholdUs: number) {
  if (outcome === "completed") return responseUs <= thresholdUs ? "good" : "late";
  if (outcome === "rejected") return "failed";
  return outcome === "deadline-exceeded" ? "deadlineExceeded" : "abandoned";
}
