import type { FirstStackSidecarV2, RecordedScheduleHeader, RecordedScheduleRow } from "@infraforge/contracts/first-stack";
import { z } from "zod";

export interface ChallengeWorkload {
  id: string; version: string; provenance: string; header: RecordedScheduleHeader; rows: RecordedScheduleRow[];
  parameters: { schema: "infraforge-first-stack-parameters/1"; rows: { id: string; plan: string; keys: string[] }[] };
  seed?: string; faults: FirstStackSidecarV2["faults"];
  observation: { fromUs: number; toUs: number; boundary: "offer-cohort-half-open; terminal-through-horizon" };
}
export const criterionSchema = z.object({ id: z.string().min(1), metric: z.enum(["delivery-permille", "error-permille", "p95-us", "fault-delivery-permille", "cost-subtotal"]),
  operator: z.enum(["gte", "lte"]), threshold: z.number().int().nonnegative().nullable(), required: z.boolean(), provenance: z.string().min(1) }).strict();
const text = z.string().min(1).max(1024), amount = z.number().int().nonnegative(), time = amount.max(300_000_000);
const range = z.object({ min: amount, max: amount }).strict().refine(r => r.min <= r.max);
export const workloadSchema = z.object({ id: text, version: text, provenance: text, seed: text.optional(),
  header: z.object({ schema: z.literal("infraforge-first-stack-schedule/1"), unit: z.literal("us"), durationUs: time.positive(), origin: z.literal("authored-schedule"), provenance: text }).strict(),
  rows: z.array(z.object({ id: text, atUs: time, operation: text }).strict()).min(1).max(64),
  parameters: z.object({ schema: z.literal("infraforge-first-stack-parameters/1"), rows: z.array(z.object({ id: text, plan: text, keys: z.array(text).min(1).max(128) }).strict()).max(64) }).strict(),
  faults: z.array(z.object({ schema: z.literal("first-stack-fault/1"), id: text, kind: z.literal("app-process-crash"), target: text, atUs: time, downtimeUs: time.positive(), recoveryUs: time.positive() }).strict()).length(1),
  observation: z.object({ fromUs: time, toUs: time, boundary: z.literal("offer-cohort-half-open; terminal-through-horizon") }).strict().refine(w => w.fromUs < w.toUs),
}).strict().refine(w => w.rows.every(r => r.atUs >= w.observation.fromUs && r.atUs < w.observation.toUs), "All recorded offers must belong to the observation cohort");
const rubricSchema = z.object({ version: text, criteria: z.array(criterionSchema).min(1).max(32) }).strict()
  .refine(r => new Set(r.criteria.map(c => c.id)).size === r.criteria.length && r.criteria.some(c => c.required), "Unique criteria and required goals must exist");
export const privateBundleSchema = z.object({ schema: z.literal("infraforge-private-scoring/1"), id: text, challengeVersion: text,
  version: text, hidden: z.array(workloadSchema).min(1).max(8), rubric: rubricSchema }).strict()
  .refine(b => new Set(b.hidden.map(w => w.id)).size === b.hidden.length, "Hidden workload IDs must be unique");
export const challengeDefinitionSchema = z.object({ schema: z.literal("infraforge-scored-challenge/2"), id: text, version: text, provenance: text,
  brief: z.object({ title: text, description: text, exclusions: z.array(text), support: z.object({ counts: z.literal("supported-logical"), timing: z.literal("assumption-only") }).strict() }).strict(),
  constraints: z.object({ topology: text, editable: z.array(text), cores: range, workers: range, queue: range, domain: text }).strict(),
  template: z.object({ layout: z.record(z.string(), z.json()), sidecar: z.json() }).strict(),
  policy: z.object({ seed: text, horizonUs: time.positive(), sampleIntervalUs: time.positive(), maxEvents: amount.positive().max(2_000_000), maxSamples: amount.positive().max(10_000), maxRawResults: amount.max(64) }).strict(),
  visible: workloadSchema,
  practice: z.array(z.object({ label: text, workload: workloadSchema }).strict()).min(1).max(8),
  scoring: z.object({ version: text, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
}).strict().refine(d => new Set([d.visible.id, ...d.practice.map(p => p.workload.id)]).size === d.practice.length + 1, "Workload IDs must be unique");
export type ChallengeCriterion = z.infer<typeof criterionSchema>;
export type ChallengeDefinition = Omit<z.infer<typeof challengeDefinitionSchema>, "template" | "visible" | "practice"> & {
  template: { layout: Record<string, unknown>; sidecar: FirstStackSidecarV2 };
  visible: ChallengeWorkload; practice: { label: string; workload: ChallengeWorkload }[];
};
export type PrivateBundle = z.infer<typeof privateBundleSchema>;
export type ScoringDefinition = ChallengeDefinition & { hidden: ChallengeWorkload[]; rubric: PrivateBundle["rubric"] };
