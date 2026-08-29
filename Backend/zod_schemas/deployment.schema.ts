import * as z from "zod";
import { DeploymentChaosNames } from "@shared/enum/DeploymentChaosNames.enum";

export const ChaosInjectionBodySchema = z.object({
  type: z.enum(DeploymentChaosNames, "Must be of the specified chaos type only"),
  resourceId: z.string("Must be of a string type")
})

export const DeploymentIdSchema = z.object({
  deploymentId: z.string("Must be a string").uuid("Invalid deployment id schema")
});

export const LoadControlBodySchema = z.object({
  targetLoadFraction: z.number("Must be a number").min(0, "Load cannot go below 0").max(2, "Load cannot exceed 200% of target")
});

export const WorkloadProfileSchema = z.object({
  targetThroughput: z.number("Must be a number").positive("Throughput must be positive").max(100000000, "Throughput is unrealistically large"),
  throughputUnit: z.enum(["per-minute", "per-hour"]),
  trafficShape: z.enum(["steady", "peak"]),
  peakMultiplier: z.number().min(1, "Multiplier must be at least 1").max(10, "Multiplier cannot exceed 10").optional(),
  readWriteRatio: z.number().min(0, "Ratio cannot be negative").max(1, "Ratio cannot exceed 1").optional(),
  payloadSize: z.enum(["light", "medium", "heavy"])
});

export const DeploymentCreateBodySchema = z.object({
  infrastructureId: z.string("Must be a string").uuid("Invalid infrastructure id"),
  workloadProfile: WorkloadProfileSchema.optional()
});

export const VerticalScaleBodySchema = z.object({
  resourceId: z.string("Must be a string"),
  skuId: z.string("Must be a string")
});

export const PoolScaleBodySchema = z.object({
  lbId: z.string("Must be a string"),
  delta: z.union([z.literal(1), z.literal(-1)], "Delta must be exactly 1 or -1")
});

export type ChaosInjectionBodySchemaType = z.infer<typeof ChaosInjectionBodySchema>;
export type DeploymentIdSchemaType = z.infer<typeof DeploymentIdSchema>;
export type LoadControlBodySchemaType = z.infer<typeof LoadControlBodySchema>;
export type WorkloadProfileSchemaType = z.infer<typeof WorkloadProfileSchema>;
export type DeploymentCreateBodySchemaType = z.infer<typeof DeploymentCreateBodySchema>;
export type VerticalScaleBodySchemaType = z.infer<typeof VerticalScaleBodySchema>;
export type PoolScaleBodySchemaType = z.infer<typeof PoolScaleBodySchema>;