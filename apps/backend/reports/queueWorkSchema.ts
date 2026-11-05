import { z } from "zod";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const QueueWorkSchema = z.object({
  version: z.literal(1), throughSecond: count, originals: count, deliveries: count, acknowledged: count, effects: count,
  ready: count, inFlight: count, scheduled: count, redeliveries: count, deadLettered: count, discarded: count, expired: count,
}).strict().superRefine((q, ctx) => {
  const owned = q.acknowledged + q.ready + q.inFlight + q.scheduled + q.deadLettered + q.discarded + q.expired;
  if (!Number.isSafeInteger(owned) || q.originals !== owned || q.redeliveries > q.deliveries ||
    q.deliveries - q.redeliveries > q.originals || q.acknowledged > q.deliveries || q.effects > q.deliveries) {
    ctx.addIssue({code: "custom", message: "Inconsistent queue ownership or work counters"});
  }
});
