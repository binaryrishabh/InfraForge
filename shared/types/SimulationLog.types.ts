export interface SimulationLog {
  timestamp: string;
  severity: "info" | "warn" | "error";
  resourceId?: string;
  source: string;
  message: string;
}