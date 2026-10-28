import type { ChaosEffect } from "./ChaosEffect.interface";
import type { PoolSnapshot } from "./PoolSnapshot.interface";
import type { ResourceMetrics } from "./ResourceMetrics.interface";
import type { SimulationSnapshot } from "./SimulationSnapshot.interface";

// One simulated second of a Model 2 run, as the live view shows it (browser worker and server replay alike).
export interface LiveView {
  simulatedSeconds: number;
  // Model 2 applies a load change from the next arrival, so the load equals its target.
  loadFraction: number;
  targetLoadFraction: number;
  metrics: Record<string, ResourceMetrics>;
  overallHealth: "healthy" | "degraded" | "saturated" | "critical";
  pools: Record<string, PoolSnapshot>;
  activeChaos: ChaosEffect[];
  traffic: NonNullable<SimulationSnapshot["traffic"]>;
}
