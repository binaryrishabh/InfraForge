/** Completed original callers since run start. Retries do not add percentile samples. */
export interface WholeRunMetrics {
  version: 1;
  throughSecond: number;
  completed: number;
  failed: number;
  deadlineExceeded: number;
  abandoned: number;
  inFlight: number;
  minMs: number | null;
  maxMs: number | null;
  // Report highMs: upper bound of the bucket; the true rank value is within it.
  // Singleton buckets below 32 us; otherwise (high-low)/low <= 1/32.
  // Nearest rank ceil(p*n); Unknown below 2 / 20 / 100 completed samples.
  percentiles: Record<"p50" | "p95" | "p99", { lowMs: number; highMs: number } | null>;
  resolution: "log-linear-32/1";
  relativeErrorBound: 0.03125;
  window: "whole run from start through this second";
}
