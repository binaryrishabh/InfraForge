import type { Sku } from "../catalog";
import type { ResourceType } from "../constants/RESOURCE_TYPES.constants";
import type { ChaosEffect } from "./ChaosEffect.interface";
import type { PoolRuntime } from "./PoolRuntime.interface";
import type { SpawnedVmInfo } from "./SpawnedVmInfo.interface";
import type { VerticalScaleAction } from "./VerticalScaleAction.interface";
import type { ResourceMetrics } from "./ResourceMetrics.interface";
import type { WorkloadProfile } from "./WorkloadProfile.interface";

export interface SimulationState {
  deploymentId: string;
  seed: number;
  simulatedSeconds: number;
  loadFraction: number;
  targetLoadFraction: number;
  targetRps: number;
  workloadProfile: WorkloadProfile;
  resourceTypes: Record<string, ResourceType>;
  resourceSkus: Record<string, Sku>;
  entryPoints: string[];
  reachable: string[];
  deadEnds: string[];
  idle: string[];
  metrics: Record<string, ResourceMetrics>;
  overallHealth: "healthy" | "degraded" | "saturated" | "critical";
  activeChaos: ChaosEffect[];
  pools: Record<string, PoolRuntime>;
  spawnedVms: SpawnedVmInfo[];
  verticalScaling: VerticalScaleAction[];
}