import type { FirstStackSidecarV2, RecordedScheduleHeader, RecordedScheduleRow } from "@infraforge/contracts/first-stack";
import { z } from "zod";
import source from "./lose-an-app-server.v1.json";
import redirect from "./url-redirect.v1.json";
import catalogue from "./catalogue-api.v1.json";
import { canonical, designRevision, hash } from "../canonical";
import { prepareFirstStackExecution } from "../execution";
import { resolveWorkload } from "../workload";
import { ConflictError, ValidationError } from "../../utils/errors";
import { reviewSidecar } from "../authoring";

export interface ChallengeWorkload {
  id: string; version: string; provenance: string; header: RecordedScheduleHeader; rows: RecordedScheduleRow[];
  parameters: { schema: "infraforge-first-stack-parameters/1"; rows: { id: string; plan: string; keys: string[] }[] };
  faults: FirstStackSidecarV2["faults"];
  observation: { fromUs: number; toUs: number; boundary: "offer-cohort-half-open; terminal-through-horizon" };
}
const criterionSchema = z.object({ id: z.string().min(1), metric: z.enum(["delivery-permille", "error-permille", "p95-us", "fault-delivery-permille", "cost-subtotal"]),
  operator: z.enum(["gte", "lte"]), threshold: z.number().int().nonnegative().nullable(), required: z.boolean(), provenance: z.string().min(1) }).strict();
const text = z.string().min(1).max(1024), amount = z.number().int().nonnegative(), time = amount.max(300_000_000);
const range = z.object({ min: amount, max: amount }).strict().refine(r => r.min <= r.max);
const workloadSchema = z.object({ id: text, version: text, provenance: text,
  header: z.object({ schema: z.literal("infraforge-first-stack-schedule/1"), unit: z.literal("us"), durationUs: time.positive(), origin: z.literal("authored-schedule"), provenance: text }).strict(),
  rows: z.array(z.object({ id: text, atUs: time, operation: text }).strict()).min(1).max(64),
  parameters: z.object({ schema: z.literal("infraforge-first-stack-parameters/1"), rows: z.array(z.object({ id: text, plan: text, keys: z.array(text).min(1).max(128) }).strict()).max(64) }).strict(),
  faults: z.array(z.object({ schema: z.literal("first-stack-fault/1"), id: text, kind: z.literal("app-process-crash"), target: text, atUs: time, downtimeUs: time.positive(), recoveryUs: time.positive() }).strict()).length(1),
  observation: z.object({ fromUs: time, toUs: time, boundary: z.literal("offer-cohort-half-open; terminal-through-horizon") }).strict().refine(w => w.fromUs < w.toUs),
}).strict().refine(w => w.rows.every(r => r.atUs >= w.observation.fromUs && r.atUs < w.observation.toUs), "All recorded offers must belong to the observation cohort");
export const challengeDefinitionSchema = z.object({ schema: z.literal("infraforge-scored-challenge/1"), id: text, version: text, provenance: text,
  brief: z.object({ title: text, description: text, exclusions: z.array(text), support: z.object({ counts: z.literal("supported-logical"), timing: z.literal("assumption-only") }).strict() }).strict(),
  constraints: z.object({ topology: text, editable: z.array(text), cores: range, workers: range, queue: range, domain: text }).strict(),
  template: z.object({ layout: z.record(z.string(), z.json()), sidecar: z.json() }).strict(),
  policy: z.object({ seed: text, horizonUs: time.positive(), sampleIntervalUs: time.positive(), maxEvents: amount.positive().max(2_000_000), maxSamples: amount.positive().max(10_000), maxRawResults: amount.max(64) }).strict(),
  visible: workloadSchema, hidden: z.array(workloadSchema).min(1).max(8),
  rubric: z.object({ version: text, criteria: z.array(criterionSchema).min(1).max(32) }).strict(),
}).strict().refine(d => new Set([d.visible.id, ...d.hidden.map(w => w.id)]).size === d.hidden.length + 1 &&
  new Set(d.rubric.criteria.map(c => c.id)).size === d.rubric.criteria.length && d.rubric.criteria.some(c => c.required), "Workload and criterion IDs must be unique and required criteria must exist");
export type ChallengeCriterion = z.infer<typeof criterionSchema>;
export interface ChallengeDefinition {
  schema: "infraforge-scored-challenge/1"; id: string; version: string;
  brief: typeof source.brief; constraints: typeof source.constraints;
  template: { layout: Record<string, unknown>; sidecar: FirstStackSidecarV2 };
  policy: typeof source.policy; visible: ChallengeWorkload; hidden: ChallengeWorkload[];
  rubric: { version: string; criteria: ChallengeCriterion[] }; provenance: string;
}
export interface ChallengeReference { id: string; version: string; definitionHash: string }

// The registry and all rubric/workload data remain in this server-only closure.
// Returning a copy prevents one request from changing another request's version.
const definitions = [source, redirect, catalogue];
export function challengeDefinition(id: string, version: string): ChallengeDefinition {
  const selected = definitions.find(d => d.id === id && d.version === version);
  if (!selected) throw new ValidationError("Scored challenge version unavailable");
  return challengeDefinitionSchema.parse(selected) as unknown as ChallengeDefinition;
}
export function pinnedChallenge(reference: ChallengeReference) {
  const definition = challengeDefinition(reference.id, reference.version);
  if (hash(definition) !== reference.definitionHash) throw new ConflictError("Pinned scored challenge definition unavailable");
  return definition;
}
export async function prepareChallengeWorkload(owner: string, layout: Record<string, unknown>, definition: ChallengeDefinition, workload: ChallengeWorkload) {
  const candidate = structuredClone(layout.firstStack) as FirstStackSidecarV2;
  candidate.workload = null;
  candidate.faults = structuredClone(workload.faults);
  async function* bytes() { yield new TextEncoder().encode([workload.header, ...workload.rows].map(row => JSON.stringify(row)).join("\n") + "\n"); }
  const schedule = await resolveWorkload(bytes(), { owner, sidecar: candidate, parameters: workload.parameters });
  candidate.workload = { scheduleHash: schedule.scheduleHash, parametersHash: schedule.parametersHash,
    resolvedIdentity: schedule.identity, executedScheduleHash: schedule.executedScheduleHash };
  return prepareFirstStackExecution(owner, layout, candidate, schedule, { ...definition.policy, maxRawResults: Math.min(definition.policy.maxRawResults, schedule.rows.length) });
}
// Only capacity choices are editable. Demand, routing, data, faults and policy
// are exact authored inputs; a learner cannot make grading easier by editing them.
export function validateChallengeDesign(layout: Record<string, unknown>, definition: ChallengeDefinition) {
  const sidecar = layout.firstStack as FirstStackSidecarV2;
  if (!sidecar || sidecar.schema !== "infraforge-first-stack-sidecar/2") throw new ValidationError("Use the scored challenge template");
  const expected = structuredClone(definition.template.sidecar), actual = structuredClone(sidecar);
  expected.designRevision = designRevision(definition.template.layout);
  if (designRevision(layout) !== expected.designRevision || sidecar.designRevision !== expected.designRevision) throw new ConflictError("Scored challenge topology or revision changed");
  if (!reviewSidecar(layout, sidecar).ok) throw new ValidationError("Supply a valid reviewed challenge design");
  for (const node of actual.nodes) {
    if (node.owner !== "compute") continue;
    for (const field of ["cores", "workers", "queue"] as const) {
      const value = node[field], range = definition.constraints[field];
      if (!Number.isSafeInteger(value) || value === null || value < range.min || value > range.max) throw new ValidationError("Capacity outside challenge constraints");
    }
    const original = expected.nodes.find(n => n.id === node.id), host = actual.placement.find(h => h.id === node.host);
    if (!original || !host || host.cores !== node.cores) throw new ValidationError("Match each application host capacity");
    node.cores = original.cores; node.workers = original.workers; node.queue = original.queue;
    host.cores = expected.placement.find(h => h.id === original.host)!.cores;
  }
  expected.faults = structuredClone(definition.visible.faults);
  // The exact visible workload is checked after server resolution, below.
  actual.workload = null; expected.workload = null;
  if (canonical(actual) !== canonical(expected)) throw new ValidationError("Challenge inputs changed outside allowed capacity choices");
}
export async function admitScoredChallenge(owner: string, layout: Record<string, unknown>, reference: { id: string; version: string }, workload: unknown, policy: unknown) {
  const definition = challengeDefinition(reference.id, reference.version);
  validateChallengeDesign(layout, definition);
  const prepared = await prepareChallengeWorkload(owner, layout, definition, definition.visible);
  if (canonical(workload) !== canonical(prepared.schedule) || canonical(policy) !== canonical(prepared.policy) ||
    hash(layout.firstStack) !== hash(prepared.sidecar)) throw new ValidationError("Submit the exact server-owned visible sample and policy");
  return { prepared, reference: { id: definition.id, version: definition.version, definitionHash: hash(definition) } };
}
// A deliberately enumerated client projection: no registry spread or raw JSON.
export async function publicChallenge(owner: string, id: string, version: string) {
  const definition = challengeDefinition(id, version), sidecar = structuredClone(definition.template.sidecar);
  sidecar.designRevision = designRevision(definition.template.layout);
  const layout = { ...definition.template.layout, firstStack: sidecar };
  const prepared = await prepareChallengeWorkload(owner, layout, definition, definition.visible);
  return { schema: "infraforge-scored-challenge-sample/1", id, version, brief: definition.brief, constraints: definition.constraints,
    layout: { ...layout, firstStack: prepared.sidecar }, workload: prepared.schedule, policy: prepared.policy };
}
