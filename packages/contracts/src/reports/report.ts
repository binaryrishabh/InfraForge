import type { WorkloadProfile } from "@infraforge/domain/workload";
import type { RunAction } from "../actions/index";
import type { ChaosEffect, PoolSnapshot } from "../telemetry/index";
import type { ChallengeEvaluation, ChallengeStatus } from "../challenges/index";

export interface RunChallengeSummary {
  id: string;
  version: number;
  title: string;
  status: ChallengeStatus;
  metCount: number;
  total: number;
}

export interface RunSummary {
  id: string;
  infrastructureId: string | null;
  infrastructureName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resourceCount: number;
  workload: WorkloadProfile | null;
  workloadSource: "captured" | "legacy" | "unavailable";
  chaosEventCount: number | null;
  topologyRevision: number | null;
  hasReportData: boolean;
  actionCount?: number;
  sourceRunId?: string | null;
  sourceRunName?: string | null;
  rerunMode?: "exact" | "current-design" | null;
  autoStopAtSimulatedSeconds?: number | null;
  challenge?: RunChallengeSummary | null;
}

export interface ReportStatement {
  id: string;
  message: string;
  sources: string[];
}

export interface ReportStage {
  name: string;
  status: string;
  message: string;
  startedAt: string;
  completedAt: string;
  warnings: string[];
  issues: string[];
  monthlyEstimateUsd?: number;
}

export interface ReportEvent {
  timestamp: string;
  event: string;
  message: string;
}

export interface ReportChaosEvent {
  timestamp: string;
  type: string;
  resourceId: string;
  message: string;
}

export interface ReportResource {
  id: string;
  name: string;
  type: string;
  skuId?: string;
}

export interface ReportTopology {
  resources: ReportResource[];
  connectionCount: number;
}

export interface ReportCheckpoint {
  capturedAt?: string;
  topologyRevision?: number;
  speed?: number;
  metricsComputedAt?: string | null;
  metricsTopologyRevision?: number;
  simulatedSeconds?: number;
  loadFraction?: number;
  health?: string;
  accumulatedCostUsd?: number;
  burnRatePerHourUsd?: number;
  targetLoadFraction?: number;
  activeChaos?: ChaosEffect[];
  restarting?: string[];
  pools?: Record<string, PoolSnapshot>;
  installedSkus?: Record<string, string>;
  measurementFreshness?: "initialized" | "previous-revision" | "current-revision" | "unknown";
  resources: Array<{ id: string; cpu?: number; memory?: number; rps?: number; connections?: number; health?: string }>;
}

export interface RunReport {
  experimentTrace?: import("./experimentTrace").ExperimentTrace;
  version: 1;
  run: RunSummary;
  originalSeed: string | null;
  legacySeed: string | null;
  stages: ReportStage[];
  timeline: ReportEvent[];
  chaosEvents: ReportChaosEvent[];
  topology: {
    original: ReportTopology | null;
    accepted: ReportTopology | null;
    changes: { added: string[]; removed: string[]; reconfigured: string[]; addedConnections: number; removedConnections: number } | null;
  };
  checkpoint: ReportCheckpoint | null;
  terminal: ReportCheckpoint | null;
  actions: RunAction[];
  provenance: { inputVersion: 1 | 2 | null; simulationModelVersion: string | null; catalogSnapshot: string | null };
  observed: ReportStatement[];
  interpreted: ReportStatement[];
  unknown: string[];
  inspectNext: string[];
  challenge?: ChallengeEvaluation | null;
}

export interface RunHistory {
  runs: RunSummary[];
  nextCursor: string | null;
}
