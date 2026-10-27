import type { RecordedExperiment } from "../challenges";

export const EXPERIMENT_BASELINE_SECONDS = 30;
export const EXPERIMENT_MAX_POINTS = 121;
export const EXPERIMENT_MAX_RESOURCES = 128;
export const EXPERIMENT_MAX_SAMPLE_BYTES = 65536;

export function experimentWindow(plan: RecordedExperiment, evaluationSecond: number | null | undefined) {
  const start = Math.max(0, plan.atSimulatedSecond - EXPERIMENT_BASELINE_SECONDS);
  if (!Number.isInteger(evaluationSecond) || evaluationSecond! < plan.atSimulatedSecond ||
      evaluationSecond! - start + 1 > EXPERIMENT_MAX_POINTS) return null;
  return { start, end: evaluationSecond! };
}

// Version 2 may record a measurement the engine does not model as null ("unknown"), never as zero.
export interface ExperimentEvidencePayload {
  version: 1 | 2;
  topologyRevision: number;
  overallHealth: "healthy" | "degraded" | "saturated" | "critical";
  loadFraction: number;
  targetLoadFraction: number;
  resources: Array<{ id: string; health: "healthy" | "degraded" | "saturated" | "failed" | "unknown";
    cpu: number | null; memory: number | null; rps?: number; connections?: number }>;
  pools: Array<{ id: string; currentReplicas: number; baseReplicas: number;
    pending: { action: "up" | "down"; secondsRemaining: number } | null }>;
}
export interface ExperimentEvidenceSample extends ExperimentEvidencePayload {
  simulatedSeconds: number;
  sampledAt: string; // Wall time when the tick computed metrics, not the later database write.
}
export interface ObservedHealthSample {
  second: number;
  health: string;
  // Includes the expiry tick and each later second through this sample, for this subject.
  completeSinceFaultEnd: boolean;
}
export interface PostFaultObservation {
  status: "not-applicable" | "fault-end-unverified" | "no-samples" | "samples-retained";
  scheduledFaultEndSecond: number;
  faultEndSecond: number | null;
  evaluationSecond: number;
  sampleCount: number;
  target: { status: "healthy-observed" | "unhealthy-through-window" | "unknown";
    firstSample: ObservedHealthSample | null; firstHealthy: ObservedHealthSample | null; healthAtEvaluation: string | null };
  system: { status: "healthy-observed" | "unhealthy-through-window" | "unknown";
    firstHealthy: ObservedHealthSample | null; healthAtEvaluation: string | null };
  pendingPoolsAtEvaluation: ExperimentEvidencePayload["pools"];
}
export interface ExperimentTrace {
  // Optional for reports produced before post-fault observation was supported.
  observation?: PostFaultObservation;
  status: "not-applicable" | "unavailable" | "complete" | "incomplete";
  reason: string;
  expectedStart: number | null;
  expectedEnd: number | null;
  actualFirst: number | null;
  actualLast: number | null;
  sampleCount: number;
  missingRanges: Array<{ start: number; end: number }>;
  points: ExperimentEvidenceSample[];
  moments: { beforeFault: number | null; atFault: number | null; firstAfterFault: number | null;
    lastActiveFault?: number | null; firstPostFault?: number | null;
    firstTargetHealthy?: number | null; firstOverallHealthy?: number | null;
    firstOverallHealthChange: number | null; evaluation: number | null } | null;
  resourceFacts: Array<{ id: string; highestCpu: { second: number; value: number } | null;
    highestMemory: { second: number; value: number } | null; firstHealthChange: number | null; firstHealthyAfterFault: number | null;
    firstHealthyAfterFaultComplete?: boolean }>;
  resourceFactsOmitted: number;
}
