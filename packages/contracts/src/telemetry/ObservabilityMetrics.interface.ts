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
  /** Added observations are optional: historical captures must not acquire invented values. */
  sampledAtUs?: number | null;
  /** Valid puts reaching capacity admission; excludes precondition failures and pre-apply cancellations. */
  puts?: number | null;
  gets?: number | null;
  heads?: number | null;
  generation?: number | null;
  objectCount?: number | null;
  overCapacity?: boolean | null;
  generatedResponseBodyBytes?: number | null;
  /** Exact sparse reasons for ALL object commands, not a put-only failure population. */
  commandReasons?: Record<string, number> | null;
  /** Current inventory only; no content or historical versions. At most 100 rows. */
  objects?: Array<{ namespace: string; key: string; generation: number; bytes: number }> | null;
  omittedObjects?: number | null;
  storedBytes: number | null;
  capacityBytes: number | null;
  committedPuts: number | null;
  replacedObjects: number | null;
  removedObjects: number | null;
  deletes: number | null;
  "object-capacity": number | null;
}
