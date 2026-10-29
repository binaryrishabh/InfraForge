/** Real queue/worker counters, opt-in upload journey revision 1. Null means Unknown. */
export interface AsyncQueueMetrics {
  version: 1;
  published: number | null;
  completed: number | null;
  readyDepth: number | null;
  oldestReadyAgeSeconds: number | null;
  inFlight: number | null;
  redeliveries: number | null;
  deadLettered: number | null;
}
