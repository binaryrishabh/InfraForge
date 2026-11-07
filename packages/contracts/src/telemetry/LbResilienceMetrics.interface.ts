/** Observer snapshots. Totals start at segment time zero; gauges describe sampledAtUs only. */
export interface LbRetryMetrics {
  version: 1;
  sampledAtUs: number;
  attempts: number;
  retries: number;
  retryLimited: number;
  activeRetries: number;
  /** Reserved backoff slots, not all scheduled retry timers. */
  retriesWaiting: number;
  suppressedByReason: { "max-attempts": number; budget: number; deadline: number; "non-retryable": number; "ambiguous-write": number };
}

export interface CircuitBreakerMetrics {
  version: 1;
  sampledAtUs: number;
  paths: Array<{
    id: string; source: string; target: string;
    profile: "caller-circuit-breaker/1";
    state: "closed" | "open" | "half-open";
    generation: number; epoch: number; consecutiveFailures: number;
    /** Absolute segment time in microseconds; null means no cooldown is scheduled. */
    openUntil: number | null;
    probeInFlight: boolean; disposed: boolean;
    /** Sparse cumulative edge counts: an absent edge was never traversed. */
    transitions: Record<string, number>;
    rejected: { open: number; "half-open": number; disposed: number };
    probes: { started: number; succeeded: number; failed: number; cancelled: number; ignored: number };
  }>;
}
