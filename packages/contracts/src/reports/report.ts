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
  learning?: import("../challenges/learning").AttemptLearning | null;
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
  rerunMode?: "exact" | "current-design" | "workload-variant" | null;
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
  lineItems?: Array<{ resourceId: string; type: string; provider?: string; skuId?: string; skuLabel?: string; monthlyUsd: number }>;
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
  traffic?: { wholeRun?: import("../telemetry/WholeRunMetrics.interface").WholeRunMetrics; objective?: import("../telemetry/ObjectiveMetrics.interface").ObjectiveMetrics; latency?: import("../telemetry/LatencyMetrics.interface").LatencyMetrics; clientRetry?: import("../telemetry/ClientRetryMetrics.interface").ClientRetryLiveMetrics; offeredRps: number; completedRps: number; failedRps: number; latencyMs: {p50: number | null; p95: number | null; p99?: number | null} };
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
  resources: Array<{startup?: import("../telemetry/StartupMetrics.interface").StartupMetrics; monitoring?: import("../telemetry").MonitoringMetrics; monitoringBackend?: import("./monitoring").MonitoringBackendMetrics; objectStorage?: import("../telemetry/ObservabilityMetrics.interface").ObjectStorageMetrics; cdn?: import("../telemetry").CdnMetrics; lbRetry?: import("../telemetry/LbResilienceMetrics.interface").LbRetryMetrics; circuitBreaker?: import("../telemetry/LbResilienceMetrics.interface").CircuitBreakerMetrics;  id: string; cache?: import("../telemetry").CacheMetrics; applicationHelpers?: import("../telemetry").ApplicationHelperMetrics; asyncQueue?: {version: 1 | 2; readyDepth: number | null; oldestReadyAgeSeconds: number | null}; security?: import("../telemetry").SecurityMetrics; queueWork?: import("../telemetry").QueueWorkMetrics; database?: import("../telemetry/DataDeliveryMetrics.interface").DatabaseMetrics; databaseReplication?: import("../telemetry/DatabaseReplicationMetrics.interface").DatabaseReplicationMetrics; lbAccounting?: import("../telemetry/LbAccountingMetrics.interface").LbAccountingMetrics; serverless?: import("../telemetry/ServerlessMetrics.interface").ServerlessMetrics; scheduler?: import("../telemetry/SchedulerMetrics.interface").SchedulerMetrics; eventBus?: import("../telemetry/EventBusMetrics.interface").EventBusMetrics; gateway?: import("../telemetry/GatewayMetrics.interface").GatewayMetrics; vmMemory?: import("../telemetry/VmMemoryMetrics.interface").VmMemoryMetrics; cpu?: number; memory?: number; rps?: number; connections?: number; health?: string }>;
}

export interface RunReport {
  /** Limits from this attempt's exact challenge identity; arithmetic uses its recorded gate total. */
  monthlyBudgets?: Array<{ criterionId: string; label: string; limitUsd: number; remainingUsd?: number }>;
  guidedReview?: import("../challenges/learning").GuidedReview | null;
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
