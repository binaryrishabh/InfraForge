import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveWorkload } from "@infraforge/domain/workload";
import { CATALOG_SNAPSHOT_DATE } from "@infraforge/catalog/types";
import { SIMULATION_MODEL_VERSION } from "@infraforge/simulation/tuning";
import type { WorkloadProfile } from "@infraforge/domain/workload";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";
import { ValidationError } from "../utils/errors";

const RunInputsV1Schema = z.object({
  version: z.literal(1),
  resources: LayoutSchema.shape.resources.unwrap(),
  connectionLines: LayoutSchema.shape.connectionLines.unwrap(),
  workloadProfile: WorkloadProfileSchema.extend({
    peakMultiplier: z.number().min(1).max(10),
    readWriteRatio: z.number().min(0).max(1),
  }),
  seed: z.string().min(1),
});
const RunInputsV2Schema = RunInputsV1Schema.extend({ version: z.literal(2),
  simulationModelVersion: z.string().min(1).max(64), catalogSnapshot: z.string().min(1).max(64) });
const RunInputsSchema = z.discriminatedUnion("version", [RunInputsV1Schema, RunInputsV2Schema]);

export function captureRunInputs(layout: unknown, workload?: WorkloadProfile) {
  const parsed = LayoutSchema.safeParse(layout);
  if (!parsed.success) throw new ValidationError("Saved infrastructure layout is invalid. Update it before deploying.");
  return RunInputsV2Schema.parse({
    version: 2, simulationModelVersion: SIMULATION_MODEL_VERSION, catalogSnapshot: CATALOG_SNAPSHOT_DATE,
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

export function assertSimulationContext(input: RunInputs) {
  if (input.version === 2 && (input.simulationModelVersion !== SIMULATION_MODEL_VERSION || input.catalogSnapshot !== CATALOG_SNAPSHOT_DATE)) {
    throw new Error("Captured simulation model/catalog differs from this runtime. Create a new run; inputs will not be silently changed.");
  }
}
