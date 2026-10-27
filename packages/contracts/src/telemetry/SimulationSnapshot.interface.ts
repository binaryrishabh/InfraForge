import type { PoolSnapshot } from "./PoolSnapshot.interface";
import type { SpawnedVmInfo } from "./SpawnedVmInfo.interface";
import type { ResourceMetrics } from "./ResourceMetrics.interface";
import type { SimulationLog } from "./SimulationLog.interface";
import type { ChaosEffect } from "./ChaosEffect.interface";
import type { RunTopology } from "../run-inputs/RunInputs.interface";

export interface SimulationSnapshot {
    deploymentId: string;
    timestamp: string;
    simulatedSeconds: number;
    loadFraction: number;
    metrics: Record<string, ResourceMetrics>;
    logs: SimulationLog[];
    health: "healthy" | "degraded" | "saturated" | "critical";
    pools?: Record<string, PoolSnapshot>;
    spawnedVms?: SpawnedVmInfo[];
    restarting?: string[];
    activeChaos?: ChaosEffect[];
    speed?: number;
    burnRatePerHourUsd?: number;
    accumulatedCostUsd?: number;
    liveTopology?: RunTopology;
    topologyRevision?: number;
    // Model 2: caller traffic during the last simulated second; latency is null when nothing completed.
    traffic?: { offeredRps: number; completedRps: number; failedRps: number; latencyMs: { p50: number | null; p95: number | null } };
}
