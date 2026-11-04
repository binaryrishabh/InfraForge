import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const LbAccountingSchema = z.object({
  profile: z.literal("lb-accounting/1"),
  rejectedAtLb: count, queuedAtLb: count, acceptedByBackend: count,
  queuedAtVm: count, rejectedByVm: count, timedOutDownstream: count,
}).strict();
