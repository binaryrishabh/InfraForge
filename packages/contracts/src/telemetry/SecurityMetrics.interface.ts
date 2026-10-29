export interface SecurityEdgeMetrics {
  path: string; source: string; target: string;
  lastDenial?: { connectionId: string; source: string; target: string; port: number; reason: string; generation?: number };
  admitted: number | null; denied: number | null; noListener: number | null;
  policyDenied: Record<string, number> | null;
  /** Actual deliveries through this path, including traffic on reused sessions. */
  backendDeliveries: number | null;
}
export interface SecurityMetrics {
  version: 1; evidence: "complete" | "omitted";
  edges: SecurityEdgeMetrics[];
  firewall?: { occupancy: number; limit: number; admissions: number; generation: number };
}
