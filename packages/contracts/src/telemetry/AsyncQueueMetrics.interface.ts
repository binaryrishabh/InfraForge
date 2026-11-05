/** Persisted experiment evidence keeps revision 1. Null means Unknown. */
export interface QueueWorkMetrics {
  version: 1;
  throughSecond: number;
  originals: number;
  deliveries: number;
  acknowledged: number;
  effects: number;
  ready: number;
  inFlight: number;
  scheduled: number;
  redeliveries: number;
  deadLettered: number;
  discarded: number;
  expired: number;
}

export interface AsyncQueueMetricsV1 {
  version: 1;
  published: number | null;
  completed: number | null;
  readyDepth: number | null;
  oldestReadyAgeSeconds: number | null;
  inFlight: number | null;
  redeliveries: number | null;
  deadLettered: number | null;
}

/** Revision 2 adds live/terminal failure observations without changing delivery behavior. */
export type AsyncQueueMetrics = AsyncQueueMetricsV1 | (Omit<AsyncQueueMetricsV1, "version"> & {
  version: 2;
  failedAttempts: number | null;
  deadLetterOverflowDiscards: number | null;
  wastedCpuSeconds: number | null;
});
