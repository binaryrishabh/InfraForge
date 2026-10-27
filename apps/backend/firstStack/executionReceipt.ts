import { z } from "zod";
import { digestPattern, imagePattern } from "./isolationPolicy";
import type { IsolationReceipt, runFirstStackContainer } from "./isolationRunner";

// Generation identifies one worker lifetime; token identifies its immutable work claim.
// Confirmed means the supervisor has reaped the child; service restart recovery uses a separate review.
export const processReceiptSchema = z.object({
  schema: z.literal("first-stack-process-receipt/1"),
  generation: z.uuid(), token: z.uuid(), source: z.string().regex(digestPattern), image: z.string().regex(imagePattern),
  exit: z.object({ code: z.number().int().min(0).max(255).nullable(), signal: z.string().regex(/^SIG[A-Z0-9]+$/).max(32).nullable() }).strict().nullable(),
  termination: z.enum(["confirmed", "not-started", "unconfirmed"]),
}).strict().refine(r => r.termination === "not-started" ? r.exit === null : r.termination !== "confirmed" ||
  r.exit !== null && ((r.exit.code !== null && r.exit.signal === null) || (r.exit.code === null && r.exit.signal !== null)));
export type ProcessReceipt = z.infer<typeof processReceiptSchema>;
export type ExecutionReceipt = IsolationReceipt | ProcessReceipt;
export type ExecutionResult = Omit<Awaited<ReturnType<typeof runFirstStackContainer>>, "receipt"> & { receipt: ExecutionReceipt };
export interface ReceiptOwner { token: string; generation: string; source: string; image: string }

// Read old receipts without relabelling their Docker evidence as process evidence.
const dockerReceiptSchema = z.object({ schema: z.literal("first-stack-isolation-receipt/1"),
  daemon: z.string().regex(digestPattern), image: z.string().regex(imagePattern), container: z.string().nullable(),
  enforcement: z.unknown(), elapsedMs: z.number().nonnegative(), outputBytes: z.number().nonnegative(),
  exit: z.object({ code: z.number().int(), oom: z.boolean() }).nullable(),
  cleanup: z.enum(["not-created", "unconfirmed", "removed", "failed"]),
}).strict();
export function readExecutionReceipt(value: unknown): ExecutionReceipt {
  return z.union([processReceiptSchema, dockerReceiptSchema]).parse(value);
}
export function receiptState(receipt: ExecutionReceipt, owner?: ReceiptOwner) {
  if (receipt.schema === "first-stack-isolation-receipt/1") return {
    clean: receipt.cleanup === "removed" || receipt.cleanup === "not-created", completed: receipt.cleanup === "removed",
  };
  const parsed = processReceiptSchema.safeParse(receipt), r = parsed.success ? parsed.data : null;
  const matches = r !== null && owner !== undefined && r.token === owner.token && r.generation === owner.generation &&
    r.source === owner.source && r.image === owner.image;
  return { clean: matches && r.termination !== "unconfirmed",
    completed: matches && r.termination === "confirmed" && r.exit?.code === 0 && r.exit.signal === null };
}
