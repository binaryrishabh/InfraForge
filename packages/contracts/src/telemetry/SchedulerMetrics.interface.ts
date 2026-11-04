export interface SchedulerMetrics {
  version: 1;
  due: number;
  fired: number;
  skippedOverlap: number;
  missed: number;
  retried: number;
  failed: number;
  completed: number;
  active: number;
  queued: number;
  retainedLatest: number;
  peakActive: number;
  peakQueued: number;
}
