import { z } from "zod";
import type { RunRecord } from "@infraforge/contracts/reports";

export const RunRecordSchema = z.object({
  schema: z.literal("infraforge-run-record/1"), id: z.string().min(1), designId: z.string().nullable(), status: z.string(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  engine: z.object({ lineage: z.enum(["1", "2"]), version: z.string().nullable(), source: z.string().nullable() }).strict(),
  experiment: z.object({ inputSchema: z.string().nullable(), input: z.unknown(), horizonSeconds: z.number().positive().nullable() }).strict(),
  evidence: z.object({ reportSchema: z.string(), report: z.unknown(), unknown: z.array(z.string()) }).strict(),
  learning: z.object({ kind: z.enum(["challenge", "lesson"]), profile: z.string().nullable(), prediction: z.unknown().optional() }).strict().optional(),
}).strict();

export function readRunRecord(value: unknown): RunRecord {
  return RunRecordSchema.parse(value);
}
