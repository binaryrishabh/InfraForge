export interface ClientRetryCounters {
  originalsOffered: number; totalAttempts: number; retriesScheduled: number; retriesIssued: number;
  recovered: number; exhausted: number; givenUp: number;
  ineligibleByReason: Record<string, number>;
  extraLoadFactor: number | null;
  perAttemptOutcomes: Array<{ attempt: number; issued: number; completed: number; rejected: number; cancelled: number; deadlineExceeded: number; abandoned: number; inFlight: number }>;
}
export interface ClientRetryLiveMetrics extends ClientRetryCounters { attemptRps: number }
