import type { Sku } from "@infraforge/catalog/types";
import type { ResourceType } from "@infraforge/domain/resource";
import type { ChaosEffect } from "@infraforge/contracts/telemetry";
import type { PoolRuntime } from "./PoolRuntime.interface";
import type { SpawnedVmInfo } from "@infraforge/contracts/telemetry";
import type { VerticalScaleAction } from "./VerticalScaleAction.interface";
import type { ResourceMetrics } from "@infraforge/contracts/telemetry";
import type { WorkloadProfile } from "@infraforge/domain/workload";

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
  downstream: Record<string, string[]>;
  upstream: Record<string, string[]>;
  sheddingLbs: string[];
}