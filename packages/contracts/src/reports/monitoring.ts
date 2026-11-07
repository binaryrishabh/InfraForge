/** Recorded owner counters through the snapshot; arrivals include duplicate samples. */
export interface MonitoringBackendMetrics {
  version: 1;
  id: string;
  received: number | null;
  duplicates: number | null;
  refused: number | null;
  latest: Array<{ target: string; measurementAt: number | null; arrivedAt: number | null; ageUs: number | null }> | null;
}
