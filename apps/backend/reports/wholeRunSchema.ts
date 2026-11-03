import { z } from "zod";

const count = z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ms = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 1000);
const percentile = z.object({ lowMs: ms, highMs: ms }).strict().refine(b => b.highMs >= b.lowMs && b.highMs <= b.lowMs * 1.03125).nullable();
export const WholeRunSchema = z.object({
  version: z.literal(1), throughSecond: count, completed: count, failed: count, deadlineExceeded: count, abandoned: count, inFlight: count,
  minMs: ms.nullable(), maxMs: ms.nullable(), percentiles: z.object({ p50: percentile, p95: percentile, p99: percentile }).strict(),
  resolution: z.literal("log-linear-32/1"), relativeErrorBound: z.literal(0.03125), window: z.literal("whole run from start through this second"),
}).strict();
