import { z } from "zod";

const variant = z.discriminatedUnion("dimension", [
  z.object({dimension: z.literal("arrival-process"), value: z.enum(["even", "poisson"])}).strict(),
  z.object({dimension: z.literal("application-cpu-variability"), value: z.enum(["fixed", "moderate", "high"])}).strict(),
]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const rerunCreation = z.discriminatedUnion("mode", [
  z.object({mode: z.literal("exact"), matchedStop: z.boolean(), expectedInputHash: hash.optional()}).strict(),
  z.object({mode: z.literal("current-design"), matchedStop: z.boolean(), expectedInputHash: hash.optional()}).strict(),
  z.object({mode: z.literal("workload-variant"), matchedStop: z.boolean(), expectedInputHash: hash, variant}).strict(),
]);
