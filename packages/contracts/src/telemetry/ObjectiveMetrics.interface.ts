import type { WorkloadObjective } from "@infraforge/domain/workload";

export interface ObjectiveCounters {
  offered: number;
  good: number;
  late: number;
  failed: number;
  deadlineExceeded: number;
  abandoned: number;
  unresolvedPastThreshold: number;
  pending: number;
}

export interface ObjectiveMetrics extends ObjectiveCounters {
  version: 1;
  objective: WorkloadObjective;
  throughUs: number;
  horizonUs: number;
  status: "unknown" | "met" | "missed" | "undetermined";
  measuredFraction: number | null;
  worstCaseFraction: number | null;
  bestCaseFraction: number | null;
}
