export type LatencyCategory = "connectionWait" | "networkTransit" | "loadBalancerPending" | "applicationQueue" | "applicationService" | "dependency" | "clientRetryDelay" | "failedAttempt";
export interface LatencyPart { meanMs: number; share: number | null }
export interface LatencyMean {
  sampleCount: number; totalMs: number;
  categories: Partial<Record<LatencyCategory, LatencyPart>>;
  unattributed: LatencyPart;
}
/** Completed caller responses in (fromUs, toUs], using the live percentile population. */
export interface LatencyMetrics {
  version: 2;
  window: { fromUs: number; toUs: number };
  status: "complete" | "sample-cap-exceeded";
  sampleCap: number;
  completedCount: number; failedCount: number; cancelledCount: number; inFlightCount: number;
  rootBoundaryExceededCount: number;
  typical: LatencyMean | null;
  slowestOnePercent: LatencyMean | null;
  p99Ms: number | null;
  unproven: "Missing boundaries and load-balancer retry backoff remain unattributed; dependency time includes its nested network and service, without database internals.";
}
