import type { CallerOutcome } from "./contracts";
import type { ObjectiveCounters, ObjectiveMetrics } from "@infraforge/contracts/telemetry";

export function classifyObjective(outcome: CallerOutcome, responseUs: number, thresholdUs: number) {
  if (outcome === "completed") return responseUs <= thresholdUs ? "good" : "late";
  if (outcome === "rejected") return "failed";
  return outcome === "deadline-exceeded" ? "deadlineExceeded" : "abandoned";
}

export function evaluateObjective({ good, pending, offered }: Pick<ObjectiveCounters, "good" | "pending" | "offered">,
  targetSuccessPercent: number): Pick<ObjectiveMetrics, "status" | "measuredFraction" | "worstCaseFraction" | "bestCaseFraction"> {
  if (offered === 0) return { status: "unknown", measuredFraction: null, worstCaseFraction: null, bestCaseFraction: null };
  // Compare the captured decimal exactly, including targets finer than a basis point.
  // BigInt cross-products avoid binary rounding at either side of the threshold.
  const [whole, decimal = ""] = String(targetSuccessPercent).split(".");
  const scale = 10n ** BigInt(decimal.length), target = BigInt(whole! + decimal) * BigInt(offered);
  const meets = (count: number) => BigInt(count) * 100n * scale >= target;
  const status = !meets(good + pending) ? "missed" : meets(good) ? "met" : "undetermined";
  return { status, measuredFraction: good / offered, worstCaseFraction: good / offered, bestCaseFraction: (good + pending) / offered };
}
