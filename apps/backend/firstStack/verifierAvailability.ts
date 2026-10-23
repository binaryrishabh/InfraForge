import { z } from "zod";
import type { ApprovedSubmissionEngine, SubmissionAdmission } from "./admission";
import { digestPattern, imagePattern, FIRST_STACK_ISOLATION } from "./isolationPolicy";

export const verifierAvailabilityKey = "infraforge:first-stack:availability:1";
export const availabilityMaxAgeMs = 5000;
const snapshotSchema = z.object({
  source: z.string().regex(digestPattern), image: z.string().regex(imagePattern),
  checkedAt: z.number().int(), expiresAt: z.number().int(), qualifiedUntil: z.number().int(),
}).strict();
export type VerifierSnapshot = z.infer<typeof snapshotSchema>;

// Reconstruct an allowlist; never forward daemon, paths, qualification checks or errors.
export function engineAvailability(value: unknown, engine: ApprovedSubmissionEngine | null,
  enabled: boolean, now = Date.now()) {
  const parsed = snapshotSchema.safeParse(value), s = parsed.success ? parsed.data : null;
  if (!enabled || !engine || !s || s.source !== engine.source || s.image !== engine.image ||
    s.checkedAt > now || s.expiresAt <= now || s.qualifiedUntil <= now ||
    s.expiresAt > s.checkedAt + availabilityMaxAgeMs || s.expiresAt <= s.checkedAt) {
    return { available: false as const, engine: null };
  }
  return { available: true as const, engine: { source: s.source, image: s.image },
    expiresAt: Math.min(s.expiresAt, s.qualifiedUntil), capacity: 1 as const,
    executor: { memoryBytes: FIRST_STACK_ISOLATION.memoryBytes, nanoCpus: FIRST_STACK_ISOLATION.nanoCpus } };
}

// The future authenticated API host supplies its existing bounded Redis connection.
// This does not mount a route or enable admission. Redis failures never use cached success.
export function createVerifierAdmission(enabled: boolean, engine: ApprovedSubmissionEngine | null,
  redis: { get(key: string): Promise<string | null> }) {
  const availability = async () => {
    try {
      const text = await redis.get(verifierAvailabilityKey);
      return engineAvailability(text && text.length <= 1024 ? JSON.parse(text) : null, engine, enabled);
    } catch { return engineAvailability(null, engine, enabled); }
  };
  const admission: SubmissionAdmission = { enabled, engine,
    available: async () => (await availability()).available };
  return { admission, availability };
}
