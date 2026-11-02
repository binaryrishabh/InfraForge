import type { ClientRetry } from "@infraforge/domain/workload";
import { RETRYABLE_FAILURES, type Cause } from "./cause";

export function clientRetryDecision(policy: ClientRetry, attempt: number, now: number, deadline: number, abandon: number, cause?: Cause) {
  if (!cause?.rootReason || !(RETRYABLE_FAILURES as readonly string[]).includes(cause.rootReason)) return { reason: "ineligible" as const };
  if (attempt + 1 >= policy.maxAttempts) return { reason: "exhausted" as const };
  const at = now + policy.backoffMs * 1000 * 2 ** attempt;
  if (at >= deadline || at >= abandon) return { reason: "deadline-too-close" as const };
  return { at };
}
