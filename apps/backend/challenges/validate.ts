import { z } from "zod";
import { DeploymentChaosNames, RESOURCE_TYPES } from "@infraforge/domain/resource";
import { validateConnection, validateDeploymentReadiness } from "@infraforge/domain/validation";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { FAULT_DURATIONS } from "../simulator/faults";
import { buildRegistry, specHash } from "./registry";
import { experimentReadiness } from "./experiment";
import { experimentWindow, EXPERIMENT_MAX_POINTS } from "@infraforge/contracts/reports";
import { recordedExperiment } from "./experiment";

/* Authoring checks for source-controlled challenges. Everything here is static and
deterministic; calibration (the starter fails, a hidden reference passes) runs the
real engine in tests/challenges.test.ts. Returns every problem found. */

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().regex(/^[a-z0-9-]{1,64}$/);
const types = Object.values(RESOURCE_TYPES) as [string, ...string[]];
const workload = z.object({
  targetThroughput: z.number().int().positive().max(100_000_000), throughputUnit: z.enum(["per-minute", "per-hour"]),
  trafficShape: z.enum(["steady", "peak"]), peakMultiplier: z.number().min(1).max(10), readWriteRatio: z.number().min(0).max(1),
  payloadSize: z.enum(["light", "medium", "heavy"]),
}).strict();
const resource = z.object({ id: z.string().min(1).max(64), type: z.enum(types), x: z.number(), y: z.number() }).passthrough();
const line = z.object({ id: z.string().min(1), sourceId: z.string().min(1), targetId: z.string().min(1), sourceType: z.enum(types), targetType: z.enum(types), port: z.number().int().min(0).max(65535) }).strict();
const definition = z.object({
  engine: z.literal("2").optional(), id, version: z.number().int().min(1).max(10_000), title: text(60), difficulty: z.enum(["starter", "core", "advanced"]),
  summary: text(200), concepts: z.array(text(40)).min(1).max(4), story: z.array(text(400)).min(1).max(4), objective: text(300),
  workload, workloadNote: text(160), evaluationSeconds: z.number().int().min(1).max(3600), evaluationNote: text(200),
  criteria: z.array(z.object({ id, kind: z.string(), label: text(120) }).passthrough()).min(1).max(8),
  predictions: z.array(z.object({ id, kind: z.string(), prompt: text(160) }).strict()).min(1).max(4),
  hints: z.array(text(300)).min(1).max(5), debrief: z.array(text(600)).min(1).max(6),
  starter: z.object({ resources: z.array(resource).max(40), connectionLines: z.array(line).max(80) }).strict().nullable(),
  experiment: z.object({ fault: z.enum(DeploymentChaosNames), atSimulatedSecond: z.number().int(), hypothesis: text(240),
    postFaultObservationSeconds: z.number().int().min(1).max(60).optional(),
    target: z.object({ resourceId: z.string().min(1).max(64), type: z.enum(types) }).strict() }).strict().optional(),
}).strict();

const CRITERIA = ["deployment-checks", "min-app-servers", "catalog-sizes", "security-clean", "monthly-budget", "overall-health",
  "no-saturation", "database-healthy", "database-connections", "survivors-unsaturated"];
const PREDICTIONS = ["overall-health", "database-health", "busiest-type", "security-clean", "scale-out", "baseline-health", "survivor-health", "target-health"];
const NEEDS_EXPERIMENT = new Set(["survivors-unsaturated", "baseline-health", "survivor-health", "target-health"]);

function checkDefinition(d: ChallengeDefinition): string[] {
  const where = `${d.id}@${d.version}`;
  const parsed = definition.safeParse(d);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${where}: ${issue.path.join(".") || "definition"} ${issue.message}`);
  const problems: string[] = [];
  const unique = (label: string, ids: string[]) => { if (new Set(ids).size !== ids.length) problems.push(`${where}: ${label} ids must be unique`); };
  unique("criterion", d.criteria.map((c) => c.id));
  unique("prediction", d.predictions.map((p) => p.id));
  for (const c of d.criteria) {
    if (!CRITERIA.includes(c.kind)) problems.push(`${where}: criterion ${c.id} has unsupported kind ${c.kind}`);
    if (NEEDS_EXPERIMENT.has(c.kind) && !d.experiment) problems.push(`${where}: criterion ${c.id} needs an experiment`);
  }
  for (const p of d.predictions) {
    if (!PREDICTIONS.includes(p.kind)) problems.push(`${where}: prediction ${p.id} has unsupported kind ${p.kind}`);
    if (NEEDS_EXPERIMENT.has(p.kind) && !d.experiment) problems.push(`${where}: prediction ${p.id} can only be judged with an experiment`);
  }
  if (d.starter) {
    const ids = d.starter.resources.map((r) => r.id);
    unique("starter resource", ids);
    for (const l of d.starter.connectionLines) {
      const source = d.starter.resources.find((r) => r.id === l.sourceId), target = d.starter.resources.find((r) => r.id === l.targetId);
      if (!source || !target) { problems.push(`${where}: starter connection ${l.id} references a missing resource`); continue; }
      if (source.type !== l.sourceType || target.type !== l.targetType) problems.push(`${where}: starter connection ${l.id} has stale types`);
      if (!validateConnection(source.type, target.type).valid) problems.push(`${where}: starter connection ${l.id} breaks the connection rules`);
    }
    const readiness = validateDeploymentReadiness(d.starter.resources, d.starter.connectionLines);
    if (!readiness.valid) problems.push(`${where}: the starter must be runnable: ${readiness.errors.join("; ")}`);
  }
  const e = d.experiment;
  if (e) {
    if (!experimentWindow(recordedExperiment(d)!, d.evaluationSeconds)) problems.push(`${where}: evidence window exceeds ${EXPERIMENT_MAX_POINTS} retained points`);
    if (!d.starter) problems.push(`${where}: an experiment needs a starter that contains its target`);
    else {
      const ready = experimentReadiness(e, d.starter, d.engine);
      if (!ready.ready) problems.push(`${where}: experiment target: ${ready.detail}`);
    }
    // The baseline is measured at full traffic, so the fault waits for the ramp to finish.
    if (d.engine !== "2" && e.atSimulatedSecond < SIMULATION_CONSTANTS.RAMP_SECONDS) problems.push(`${where}: the fault must not start before the ${SIMULATION_CONSTANTS.RAMP_SECONDS}-second ramp ends`);
    // The expiry tick still measures the fault. Observation starts with the next completed tick.
    if (e.atSimulatedSecond < 1) problems.push(`${where}: the fault needs a measured baseline at second 1 or later`);
    const last = e.atSimulatedSecond + FAULT_DURATIONS[e.fault];
    const evaluation = last + (e.postFaultObservationSeconds ?? 0);
    if (d.evaluationSeconds !== evaluation) problems.push(e.postFaultObservationSeconds === undefined
      ? `${where}: evaluation must be at second ${last}, the fault's last active second`
      : `${where}: evaluation must be at second ${evaluation}: fault ends at ${last} plus ${e.postFaultObservationSeconds} observation seconds`);
  }
  return problems;
}

/* Versions are contiguous per challenge, every published version keeps its pinned
hash, and no published version disappears. */
export function validateChallengeVersions(versions: readonly ChallengeDefinition[], published: Readonly<Record<string, string>>): string[] {
  const problems = versions.flatMap(checkDefinition);
  try { buildRegistry(versions); } catch (error) { problems.push((error as Error).message); }
  const byId = new Map<string, number[]>();
  for (const d of versions) byId.set(d.id, [...(byId.get(d.id) ?? []), d.version]);
  for (const [challenge, list] of byId) {
    const sorted = [...list].sort((a, b) => a - b);
    if (sorted.some((v, i) => v !== i + 1)) problems.push(`${challenge}: versions must run 1, 2, 3… without gaps (found ${sorted.join(", ")})`);
  }
  for (const d of versions) {
    const key = `${d.id}@${d.version}`;
    if (!(key in published)) problems.push(`${key}: not pinned; add its spec hash to the published list`);
    else if (published[key] !== specHash(d)) problems.push(`${key}: a published version changed; ship the change as version ${Math.max(...byId.get(d.id)!) + 1} instead`);
  }
  for (const key of Object.keys(published)) {
    if (!versions.some((d) => `${d.id}@${d.version}` === key)) problems.push(`${key}: a published version was removed; old attempts need it`);
  }
  return problems;
}
