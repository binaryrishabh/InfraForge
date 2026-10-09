import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveWorkload } from "@infraforge/domain/workload";
import type { WorkloadProfile } from "@infraforge/domain/workload";
import type { RunInputs } from "@shared/interface/RunInputs.interface";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";
import { ValidationError } from "../utils/errors";

const RunInputsSchema = z.object({
  version: z.literal(1),
  resources: LayoutSchema.shape.resources.unwrap(),
  connectionLines: LayoutSchema.shape.connectionLines.unwrap(),
  workloadProfile: WorkloadProfileSchema.extend({
    peakMultiplier: z.number().min(1).max(10),
    readWriteRatio: z.number().min(0).max(1),
  }),
  seed: z.string().min(1),
});

export function captureRunInputs(layout: unknown, workload?: WorkloadProfile) {
  const parsed = LayoutSchema.safeParse(layout);
  if (!parsed.success) throw new ValidationError("Saved infrastructure layout is invalid. Update it before deploying.");
  return RunInputsSchema.parse({
    version: 1,
    resources: parsed.data.resources,
    connectionLines: parsed.data.connectionLines,
    workloadProfile: resolveWorkload(workload),
    seed: randomUUID(),
  });
}

export function readRunInputs(value: unknown): RunInputs {
  const parsed = RunInputsSchema.safeParse(value);
  if (!parsed.success) throw new Error("Original run inputs are missing or unsupported. Create a new deployment; legacy inputs cannot be reconstructed safely.");
  return parsed.data;
}

export function engineSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  return Math.abs(hash);
}
