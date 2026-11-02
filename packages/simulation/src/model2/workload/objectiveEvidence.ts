import type { WorkloadObjective } from "@infraforge/domain/workload";
import type { ObjectiveMetrics } from "@infraforge/contracts/telemetry";
import type { CallerOutcome } from "./contracts";
import { classifyObjective } from "./objective";

// Terminal counters are fixed size; unresolved roots belong to the existing caller live map.
export function objectiveEvidence(objective: WorkloadObjective, horizonUs: number) {
  const thresholdUs = objective.maxResponseMs * 1000;
  const terminal = { good: 0, late: 0, failed: 0, deadlineExceeded: 0, abandoned: 0 };
  return {
    finish(outcome: CallerOutcome, responseUs: number) { terminal[classifyObjective(outcome, responseUs, thresholdUs)]++; },
    measure(offered: number, throughUs: number, live: Iterable<{ work: { offeredAt: number } }>): ObjectiveMetrics {
      let unresolvedPastThreshold = 0, pending = 0;
      for (const { work } of live) {
        if (throughUs - work.offeredAt > thresholdUs) unresolvedPastThreshold++;
        else pending++;
      }
      return { version: 1, objective: { ...objective }, throughUs, horizonUs, offered, ...terminal, unresolvedPastThreshold, pending };
    },
  };
}
