import { z } from "zod";
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const reading = z.object({ id: z.string().min(1).max(256), residentBytes: count, limitBytes: count,
  headroomBytes: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable(),
  holdingRequests: count, activeRequests: count, allocationRejected: count,
  comparison: z.enum(["within", "exceeds", "unknown"]), peakResidentBytes: count,
}).strict().superRefine((r, ctx) => {
  const known = r.residentBytes !== null && r.limitBytes !== null;
  if (r.headroomBytes !== (known ? r.limitBytes! - r.residentBytes! : null) || r.comparison !== (known ? r.residentBytes! > r.limitBytes! ? "exceeds" : "within" : "unknown")) ctx.addIssue({ code: "custom", message: "Modeled memory comparison and headroom must match known amounts; missing amounts stay Unknown." });
  if (r.holdingRequests !== null && r.activeRequests !== null && r.activeRequests > r.holdingRequests) ctx.addIssue({ code: "custom", message: "Active requests must hold memory." });
  if (r.residentBytes !== null && r.peakResidentBytes !== null && r.peakResidentBytes < r.residentBytes) ctx.addIssue({ code: "custom", message: "Peak cannot be smaller than current modeled resident memory." });
});
export const VmMemorySchema = z.object({ version: z.literal(1), resources: z.array(reading).min(1).max(128).refine(rows => new Set(rows.map(r => r.id)).size === rows.length) }).strict();
