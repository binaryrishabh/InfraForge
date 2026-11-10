import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().default(null);
const flag = z.boolean().nullable().default(null);
export const DatabaseRejoinMetricsSchema = z.object({
  version: z.literal(1), memberId: z.string().min(1).max(1024).nullable().default(null),
  sourceMember: z.literal("replica").nullable().default(null), epoch: count,
  state: z.enum(["waiting-for-return", "catching-up", "replica"]).nullable().default(null),
  targetAvailable: flag, writerAvailable: flag, snapshotRows: count, snapshotApplied: flag, pendingBatches: count,
  committedOperations: count, replayedOperations: count, pendingOperations: count, eligible: flag, joinedAtUs: count,
}).strict();
