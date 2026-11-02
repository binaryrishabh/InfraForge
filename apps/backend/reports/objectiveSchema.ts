import { z } from "zod";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";

const count = z.number().finite().int().min(0).max(100_000_000);
const time = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);
const fraction = z.number().finite().min(0).max(1).nullable();
export const ObjectiveSchema = z.object({
  version: z.literal(1), objective: WorkloadProfileSchema.shape.workloadObjective.unwrap(),
  throughUs: time, horizonUs: time,
  offered: count, good: count, late: count, failed: count, deadlineExceeded: count, abandoned: count,
  unresolvedPastThreshold: count, pending: count,
  status: z.enum(["unknown", "met", "missed", "undetermined"]),
  measuredFraction: fraction, worstCaseFraction: fraction, bestCaseFraction: fraction,
}).strict().refine(v => v.throughUs <= v.horizonUs &&
  v.offered === v.good + v.late + v.failed + v.deadlineExceeded + v.abandoned + v.unresolvedPastThreshold + v.pending &&
  (v.offered === 0 ? v.status === "unknown" && v.measuredFraction === null && v.worstCaseFraction === null && v.bestCaseFraction === null :
    v.status !== "unknown" && v.measuredFraction === v.good / v.offered && v.worstCaseFraction === v.measuredFraction && v.bestCaseFraction === (v.good + v.pending) / v.offered));
