import { z } from "zod";

const count = z.number().int().nonnegative().max(100000000);
const ms = z.number().finite().nonnegative().max(3600000);
const part = z.object({ meanMs: ms, share: z.number().min(0).max(1).nullable() }).strict();
const mean = z.object({ sampleCount: count.min(1), totalMs: ms,
  categories: z.partialRecord(z.enum(["connectionWait", "networkTransit", "loadBalancerPending", "applicationQueue", "applicationService", "dependency", "clientRetryDelay", "failedAttempt"]), part),
  unattributed: part }).strict();
export const LatencySchema = z.object({
  version: z.literal(2), window: z.object({ fromUs: z.number().int().min(0).max(3600000000), toUs: z.number().int().min(0).max(3600000000) }).strict(),
  status: z.enum(["complete", "sample-cap-exceeded"]), sampleCap: count.min(1).max(10000),
  completedCount: count, failedCount: count, cancelledCount: count, inFlightCount: count, rootBoundaryExceededCount: count,
  typical: mean.nullable(), slowestOnePercent: mean.nullable(), p99Ms: ms.nullable(),
  unproven: z.literal("Missing boundaries and load-balancer retry backoff remain unattributed; dependency time includes its nested network and service, without database internals."),
}).strict();
