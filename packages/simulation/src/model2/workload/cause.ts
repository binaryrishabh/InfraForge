import type { FailureReason } from "../network/contracts";

/** failure-cause/1: one bounded summary, never a reconstructed chain. */
export interface Cause { rootReason: FailureReason | null; rootResource: string | null; depth: number }
export function seedCause(rootReason: FailureReason | null, rootResource: string | null, depth = 0): Cause {
  // Oversized identities become Unknown together; never retain a misleading partial identity.
  const known = rootReason !== null && rootResource !== null && rootReason.length <= 64 && rootResource.length <= 256;
  return { rootReason: known ? rootReason : null, rootResource: known ? rootResource : null,
    depth: Number.isFinite(depth) ? Math.min(255, Math.max(0, Math.floor(depth))) : 255 };
}
export const carryCause = (cause?: Cause): Cause => cause ? seedCause(cause.rootReason, cause.rootResource, cause.depth + 1) : seedCause(null, null);
export const causeFields = (cause?: Cause): Record<string, string | number | null> => cause ? { rootReason: cause.rootReason, rootResource: cause.rootResource, depth: cause.depth } : {};
