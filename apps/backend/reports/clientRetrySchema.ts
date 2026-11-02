import { z } from "zod";

const count = z.number().int().nonnegative().max(100_000_000);
export const ClientRetryLiveSchema = z.object({
  originalsOffered: count, totalAttempts: count, retriesScheduled: count, retriesIssued: count,
  recovered: count, exhausted: count, givenUp: count, attemptRps: count,
  ineligibleByReason: z.partialRecord(z.enum(["rate-limited", "circuit-open", "session-limit", "unknown"]), count),
  extraLoadFactor: z.number().min(0).max(4).nullable(),
  perAttemptOutcomes: z.array(z.object({ attempt: z.number().int().min(0).max(3), issued: count, completed: count, rejected: count, cancelled: count, deadlineExceeded: count, abandoned: count, inFlight: count }).strict()).min(2).max(4),
}).strict();
