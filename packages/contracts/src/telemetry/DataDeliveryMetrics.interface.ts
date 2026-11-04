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
