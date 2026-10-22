import { z } from "zod";
import type { RunRecord } from "@infraforge/contracts/reports";

export const RunReferenceSchema = z.union([
  z.object({ engine: z.literal("1"), store: z.literal("Deployment"), id: z.string().min(1).max(256) }).strict(),
  z.object({ engine: z.literal("2"), store: z.enum(["InternalModel2Run", "FirstStackRun"]), id: z.string().min(1).max(256) }).strict(),
]);
export const RunRecordSchema = z.object({
  schema: z.literal("infraforge-run-record/1"), id: z.string().min(1), designId: z.string().nullable(), status: z.string(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  engine: z.object({ lineage: z.enum(["1", "2"]), version: z.string().nullable(), source: z.string().nullable() }).strict(),
  experiment: z.object({ inputSchema: z.string().nullable(), input: z.unknown(), horizonSeconds: z.number().positive().nullable() }).strict(),
  evidence: z.object({ reportSchema: z.string(), report: z.unknown(), unknown: z.array(z.string()) }).strict(),
  reference: RunReferenceSchema.optional(),
  availability: z.object({ report: z.enum(["readable", "partial", "unavailable"]),
    execution: z.enum(["available", "execution-retired", "unavailable"]), replay: z.enum(["available", "unavailable"]), reasons: z.array(z.string()) }).strict().optional(),
  lineage: z.object({ kind: z.literal("migrated-from"), source: RunReferenceSchema }).strict().optional(),
  learning: z.object({ kind: z.enum(["challenge", "lesson"]), profile: z.string().nullable(), prediction: z.unknown().optional() }).strict().optional(),
}).strict();

export function readRunRecord(value: unknown): RunRecord {
  const record = RunRecordSchema.parse(value);
  const reports = record.engine.lineage === "1" ? ["infraforge-run-report/1"] :
    ["infraforge-internal-report/1", "infraforge-internal-report/2", "infraforge-first-stack-report/1"];
  const inputs = record.engine.lineage === "1" ? ["infraforge-run-inputs/1", "infraforge-run-inputs/2"] :
    ["infraforge-internal-execution/1", "infraforge-internal-execution/2", "infraforge-first-stack-submission/1"];
  if (!reports.includes(record.evidence.reportSchema) || record.experiment.inputSchema !== null && !inputs.includes(record.experiment.inputSchema)) throw Error("Unsupported historical input/report schema; no reinterpretation");
  if (record.reference && (record.reference.id !== record.id || record.reference.engine !== record.engine.lineage)) throw Error("Historical run reference disagrees with recorded identity");
  return record;
}
