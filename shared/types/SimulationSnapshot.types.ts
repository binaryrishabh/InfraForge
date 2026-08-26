import type { ResourceMetrics } from "./ResourceMetrics.types";
import type { SimulationLog } from "./SimulationLog.types";

export interface SimulationSnapshot {
  deploymentId: string;
  timestamp: string;
  simulatedSeconds: number;
  loadFraction: number;
  metrics: Record<string, ResourceMetrics>;
  logs: SimulationLog[];
  health: "healthy" | "degraded" | "saturated" | "critical";
}