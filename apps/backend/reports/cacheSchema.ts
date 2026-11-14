import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const id = z.string().min(1).max(256);
export const CacheMetricsSchema = z.object({ version: z.literal(1), hits: count, misses: count,
  expirations: count, evictions: count, coalescedWaiters: count, staleServed: count.optional(), maxStaleAgeUs: count.optional(), outdatedHits: count.optional(), maxVersionsBehind: count.optional(),
  absentAnswers: count.optional(), negativeHits: count.optional(), absentSourceReads: count.optional() });
export const ApplicationHelperMetricsSchema = z.object({ version: z.literal(1), helpers: z.array(z.object({
  id, cacheId: id, databaseId: id, received: count, completed: count, failed: count, live: count,
  databaseFetches: count, cacheFailures: count, coalescedWaiters: count, fillsInProgress: count, invalidations: count,
})).min(1).max(500).refine(rows => new Set(rows.map(row => row.id)).size === rows.length) });
