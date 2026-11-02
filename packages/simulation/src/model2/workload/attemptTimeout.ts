import type { EventKernel } from "../time";
import { identity } from "./arrivals";
import type { Invocation, OperationClass, Receipt } from "./contracts";

// The final read attempt waits for its outcome or the original caller stop.
export function attemptTimeout(kernel: EventKernel, operation: OperationClass, work: Invocation, expire: () => void) {
  const policy = operation.clientRetry;
  if (policy?.attemptTimeoutMs === undefined || operation.idempotency !== "read-only" || work.attempt + 1 >= policy.maxAttempts) return;
  return kernel.schedule(kernel.now + policy.attemptTimeoutMs * 1000, 1, identity("client-attempt-timeout", work.rootId, work.attempt), expire);
}

// Both caller stops and attempt stops use the same entry receipt contract.
export function cancelCallerReceipt(operation: OperationClass, receipt: Receipt | undefined, counts: { cancellationRequested: number; cancellationConfirmedAtEntry: number }) {
  if (operation.onCallerStop !== "request-cancellation" || !receipt) return;
  counts.cancellationRequested++;
  const result = receipt.cancel();
  if (result === "cancelled") counts.cancellationConfirmedAtEntry++;
  return result;
}
