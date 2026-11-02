/** Resource-owned Model 2 evidence; absent values are Unknown. Counters accumulate since run start. */
export interface MonitoringMetrics {
  version: 1;
  generated: number | null;
  collections: number | null;
  collectionFailures: number | null;
  exported: number | null;
  dropped: number | null;
  droppedBeforeExport: number | null;
  discardedUnconfirmed: number | null;
  batches: number | null;
  failedBatches: number | null;
  bufferedSamples: number | null;
  bufferedBytes: number | null;
  inFlightSamples: number | null;
  inFlightBytes: number | null;
  freshness: Array<{ target: string; measuredAt: number | null; ageUs: number | null; state: string | null }> | null;
}

export interface ObjectStorageMetrics {
  version: 1;
  storedBytes: number | null;
  capacityBytes: number | null;
  committedPuts: number | null;
  replacedObjects: number | null;
  removedObjects: number | null;
  deletes: number | null;
  "object-capacity": number | null;
}
