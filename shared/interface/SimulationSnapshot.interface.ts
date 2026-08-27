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
}