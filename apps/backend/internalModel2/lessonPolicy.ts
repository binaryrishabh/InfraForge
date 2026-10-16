import { z } from "zod";
import { LESSON_VERSION } from "@infraforge/contracts/internal-lessons";
import type { ReadPhase } from "@infraforge/contracts/internal-lessons";
import { contentHash } from "./identity";
import { LESSON_SANDBOX } from "./lessonLimits";
export const lessonChoice = z.object({ schema: z.literal(LESSON_VERSION), infrastructureId: z.uuid(), expectedDesignUpdatedAt: z.iso.datetime(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), phase: z.enum(["before", "during", "after"]) }).strict();
export const lessonSubmission = lessonChoice.extend({ reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export interface LessonPolicy { schema: typeof LESSON_VERSION; phase: ReadPhase; image: string; inputHash: string; reviewHash: string; limits: typeof LESSON_SANDBOX; fingerprint: string }
export function makeLessonPolicy(inputHash: string, phase: ReadPhase, image: string, reviewHash: string): LessonPolicy {
  const body = { schema: LESSON_VERSION as typeof LESSON_VERSION, phase, image, inputHash, reviewHash, limits: LESSON_SANDBOX };
  return { ...body, fingerprint: contentHash(body) };
}
export function readLessonPolicy(value: unknown, inputHash: string): LessonPolicy {
  const policy = value as LessonPolicy;
  const expected = makeLessonPolicy(inputHash, policy?.phase, policy?.image, policy?.reviewHash);
  if (!policy || !["before", "during", "after"].includes(policy.phase) || !/^sha256:[a-f0-9]{64}$/.test(policy.image) ||
      !/^[a-f0-9]{64}$/.test(policy.reviewHash) || contentHash(policy) !== contentHash(expected)) throw Error("Lesson policy is corrupt or incompatible");
  return policy;
}
