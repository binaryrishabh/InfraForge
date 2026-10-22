import type { RunAvailability } from "@infraforge/contracts/reports";

// Trusted server policy, independent of report reading. Activation remains a
// separate decision; historical projections can rehearse retirement today.
export interface HistoricalExecutionPolicy { model1Retired: boolean }
export const historicalExecutionPolicy: HistoricalExecutionPolicy = Object.freeze({ model1Retired: false });
export function model1Availability(input: unknown, policy = historicalExecutionPolicy): RunAvailability {
  return { report: input ? "readable" : "partial", execution: policy.model1Retired ? "execution-retired" : "available",
    replay: "unavailable", reasons: [
      ...(policy.model1Retired ? ["Execution retired: historical Model 1 reports remain readable; exact reruns and improvements are unavailable."] : []),
      "Model 1 report playback uses stored observations; deterministic prefix verification is unavailable.",
      ...(!input ? ["Original input or provenance is missing, corrupt or unsupported; no design was reconstructed."] : []),
    ] };
}
