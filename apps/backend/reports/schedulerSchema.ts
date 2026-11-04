import { z } from "zod";
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const SchedulerMetricsSchema = z.object({ version: z.literal(1), due: count.max(10000), fired: count.max(100000), skippedOverlap: count, missed: count, retried: count, failed: count, completed: count, active: count.max(128), queued: count.max(128), retainedLatest: count.max(1), peakActive: count.max(128), peakQueued: count.max(128) }).strict().superRefine((s, ctx) => {
  if (s.due !== s.completed + s.missed + s.active + s.queued + s.retainedLatest || s.failed > s.missed || s.skippedOverlap > s.missed || s.fired < s.retried || s.fired - s.retried > s.due || s.active > s.peakActive || s.queued > s.peakQueued) ctx.addIssue({ code: "custom", message: "Inconsistent Scheduler invocation ownership counters" });
});
