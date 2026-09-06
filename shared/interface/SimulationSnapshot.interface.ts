import type { PoolSnapshot } from "./PoolSnapshot.interface";
import type { SpawnedVmInfo } from "./SpawnedVmInfo.interface";
import type { ResourceMetrics } from "./ResourceMetrics.interface";
import type { SimulationLog } from "./SimulationLog.interface";
import type { ChaosEffect } from "./ChaosEffect.interface";

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
}