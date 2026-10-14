import { createHash } from "node:crypto";
import { z } from "zod";
import { EXPERIMENT_MAX_RESOURCES, EXPERIMENT_MAX_SAMPLE_BYTES, type ExperimentEvidencePayload } from "@infraforge/contracts/reports";

export interface CapturedEvidence { simulatedSeconds: number; sampledAt: Date; payload: ExperimentEvidencePayload; hash: string }
export interface EvidenceBuffer { window: { start: number; end: number }; pending: CapturedEvidence[]; captureError?: Error }

const id = z.string().min(1).max(256);
const amount = z.number().finite().min(0).max(1e12);
const count = z.number().int().min(0).max(EXPERIMENT_MAX_RESOURCES);
export const evidencePayload = z.object({
  version: z.literal(1), topologyRevision: z.number().int().min(0).max(1_000_000),
  overallHealth: z.enum(["healthy", "degraded", "saturated", "critical"]),
  loadFraction: amount.max(10), targetLoadFraction: amount.max(10),
  resources: z.array(z.object({ id, health: z.enum(["healthy", "degraded", "saturated", "failed"]),
    cpu: amount.max(100), memory: amount.max(100), rps: amount.optional(), connections: amount.optional() }).strict()).min(1).max(EXPERIMENT_MAX_RESOURCES),
  pools: z.array(z.object({ id, currentReplicas: count, baseReplicas: count,
    pending: z.object({ action: z.enum(["up", "down"]), secondsRemaining: z.number().int().min(0).max(3600) }).strict().nullable() }).strict()).max(EXPERIMENT_MAX_RESOURCES),
}).strict().superRefine((value, ctx) => {
  for (const field of ["resources", "pools"] as const) {
    if (new Set(value[field].map((r) => r.id)).size !== value[field].length) ctx.addIssue({ code: "custom", message: `${field} ids must be unique` });
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > EXPERIMENT_MAX_SAMPLE_BYTES) ctx.addIssue({ code: "custom", message: "Evidence sample exceeds its byte limit" });
});

export function sampleHash(payload: unknown) {
  // Wall capture time is not part of deterministic tick evidence. Arrays of named
  // measurements have stable id ordering; topology ordering lives in runInputs.
  const value = evidencePayload.parse(payload);
  return createHash("sha256").update(JSON.stringify({ ...value,
    resources: [...value.resources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    pools: [...value.pools].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  })).digest("hex");
}
