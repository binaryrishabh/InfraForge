import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(256);
export const LbRetrySchema = z.object({
  version: z.literal(1), sampledAtUs: count,
  attempts: count, retries: count, retryLimited: count, activeRetries: count, retriesWaiting: count,
  suppressedByReason: z.object({ "max-attempts": count, budget: count, deadline: count, "non-retryable": count, "ambiguous-write": count }).strict(),
}).strict().refine(m => m.retries <= m.attempts && m.activeRetries <= m.retries && m.retryLimited === m.suppressedByReason.budget);

export const CircuitBreakerSchema = z.object({
  version: z.literal(1), sampledAtUs: count,
  paths: z.array(z.object({
    id, source: id, target: id, profile: z.literal("caller-circuit-breaker/1"),
    state: z.enum(["closed", "open", "half-open"]), generation: count, epoch: count, consecutiveFailures: count,
    openUntil: count.nullable(), probeInFlight: z.boolean(), disposed: z.boolean(),
    transitions: z.partialRecord(z.enum(["closed->open", "open->half-open", "half-open->closed", "half-open->open", "closed->closed", "open->closed"]), count),
    rejected: z.object({open: count, "half-open": count, disposed: count}).strict(),
    probes: z.object({started: count, succeeded: count, failed: count, cancelled: count, ignored: count}).strict(),
  }).strict()).min(1).max(500),
}).strict().refine(m => new Set(m.paths.map(p => p.id)).size === m.paths.length);
