import type { PoolSnapshot } from "./PoolSnapshot.interface";
import type { SpawnedVmInfo } from "./SpawnedVmInfo.interface";
import type { ResourceMetrics } from "./ResourceMetrics.interface";
import type { SimulationLog } from "./SimulationLog.interface";

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
  speed?: number;   // current simulation speed multiplier (0=pause, 1, 10, 60)
  burnRatePerHourUsd?: number;   // current $/hr to run the live infrastructure
  accumulatedCostUsd?: number;   // total $ burned so far (function of simulated time)
}