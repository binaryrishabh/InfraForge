import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
// The engine has no aggregate waiter-refusal counter. Refuse invented values.
export const CdnMetricsSchema = z.object({ version: z.literal(1),
  hits: count, misses: count, originRequests: count, fills: count, expirations: count,
  evictions: count, coalesced: count, purged: count, staleFills: count,
  "cdn-waiter-capacity": z.null(),
});
