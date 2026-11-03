import type { ReplayQueueStatus } from "@infraforge/contracts/deployment";
import { z } from "zod";

const basis = z.string().min(1).max(1200);
const estimate = z.number().finite().nonnegative().nullable();
export const ReplayQueueStatusSchema: z.ZodType<ReplayQueueStatus> = z.discriminatedUnion("state", [
  z.object({ state: z.literal("queued"), position: z.number().int().positive(), runsAhead: z.number().int().nonnegative(), estimatedWaitSeconds: estimate, basis }).strict(),
  z.object({ state: z.literal("replaying"), position: z.null(), runsAhead: z.literal(0), estimatedWaitSeconds: estimate, basis }).strict(),
  z.object({ state: z.literal("unknown"), position: z.null(), runsAhead: z.null(), estimatedWaitSeconds: z.null(), basis }).strict(),
]);
