/** Current populations and cumulative counters from Model 2; absent evidence stays null. */
export interface DatabaseMetrics {
  readRouting?: import("./DatabaseReadRoutingMetrics.interface").DatabaseReadRoutingMetrics;
  version: 1;
  serving: number | null;
  waiting: number | null;
  queued: number | null;
  rejected: number | null;
  sessionRefused: number | null;
  "query-queue-full": number | null;
}

export interface CacheMetrics {
  version: 1;
  hits: number | null;
  misses: number | null;
  expirations: number | null;
  evictions: number | null;
  coalescedWaiters: number | null;
  /** Present only with a saved stale age bound: answers served from an expired body, and the oldest such age. A null age means none served. */
  staleServed?: number | null;
  maxStaleAgeUs?: number | null;
}

export interface CdnMetrics {
  version: 1;
  hits: number | null;
  misses: number | null;
  originRequests: number | null;
  fills: number | null;
  expirations: number | null;
  evictions: number | null;
  coalesced: number | null;
  purged: number | null;
  staleFills: number | null;
  "cdn-waiter-capacity": number | null;
}

/** Each cache-aside helper owns its counters; all counts accumulate since run start.
 * live and fillsInProgress are current populations. No caller or cache-command totals are inferred. */
export interface ApplicationHelperMetrics {
  version: 1;
  helpers: Array<{
    id: string; cacheId: string; databaseId: string;
    received: number | null; completed: number | null; failed: number | null; live: number | null;
    databaseFetches: number | null; cacheFailures: number | null; coalescedWaiters: number | null;
    fillsInProgress: number | null; invalidations: number | null;
  }>;
}
