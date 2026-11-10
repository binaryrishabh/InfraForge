import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { DeploymentChaosNames, RESOURCE_TYPES } from "@infraforge/domain/resource";
import { validateConnection } from "@infraforge/domain/validation";
import { validateModel2Readiness } from "@infraforge/simulation/internal-product";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { FAULT_DURATIONS } from "../simulator/faults";
import { buildRegistry, specHash } from "./registry";
import { experimentReadiness } from "./experiment";
import { experimentWindow, EXPERIMENT_MAX_POINTS } from "@infraforge/contracts/reports";
import { recordedExperiment } from "./experiment";
import { scenarioError } from "@infraforge/simulation/model2-run";
import { recordedScenario } from "./scenario";
import { captureRunInputs } from "../deployments/runInputs";
import { isDepthCriterion, depthResourceType, depthCriterionLimits } from "./depthCriteria";

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
  scenario: z.unknown().optional(),
}).strict();

const CRITERIA = ["database-redundancy", "monitoring-delivery", "pool-in-service", "deployment-checks", "min-app-servers", "catalog-sizes", "security-clean", "monthly-budget", "overall-health",
  "no-saturation", "database-healthy", "database-connections", "survivors-unsaturated", "terminal-p95", "backend-admission-budget", "queue-work", "queue-ready-age", "firewall-admission-budget", "gateway-route-work", "scheduler-work", "function-work", "caller-outcomes"];
const PREDICTIONS = ["overall-health", "database-health", "busiest-type", "security-clean", "scale-out", "baseline-health", "survivor-health", "target-health", "database-admission"];
const NEEDS_EXPERIMENT = new Set(["survivors-unsaturated", "baseline-health", "survivor-health", "target-health"]);

// Authoring checks repeatedly visit the same source definitions. Reuse only a
// successful semantic check of an identical deep snapshot. Schema validation,
// registry structure and published identities are still checked on every call.
const validatedDefinitions = new WeakMap<ChallengeDefinition, ChallengeDefinition>();

function checkDefinition(d: ChallengeDefinition): string[] {
  const where = `${d.id}@${d.version}`;
  const parsed = definition.safeParse(d);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${where}: ${issue.path.join(".") || "definition"} ${issue.message}`);
  const previous = validatedDefinitions.get(d);
  if (previous && isDeepStrictEqual(previous, d)) return [];
  const problems: string[] = [];
  if (d.scenario !== undefined) {
    const error = scenarioError(d.scenario, d.evaluationSeconds);
    if (error) problems.push(`${where}: ${error}`);
    if (d.experiment || d.engine !== "2") problems.push(`${where}: scenarios require Model 2 and exclude experiments`);
    if (!d.starter) problems.push(`${where}: a scenario needs a runnable starter`);
    if (!error && d.starter) {
      try { recordedScenario(d, captureRunInputs(d.starter, d.workload, `challenge:${d.id}:v${d.version}`)); }
      catch (error) { problems.push(`${where}: scenario: ${(error as Error).message}`); }
    }
  }
  const unique = (label: string, ids: string[]) => { if (new Set(ids).size !== ids.length) problems.push(`${where}: ${label} ids must be unique`); };
  unique("criterion", d.criteria.map((c) => c.id));
  unique("prediction", d.predictions.map((p) => p.id));
  for (const c of d.criteria) {
    if (c.kind === "database-redundancy" && (d.engine !== "2" || !id.safeParse(c.resourceId).success ||
      !d.starter?.resources.some(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.Database && r.databaseReplication?.enabled) ||
      d.scenario?.databaseRecovery?.resourceId !== c.resourceId)) problems.push(`${where}: database-redundancy needs Model 2, its named enabled database and an approved recovery scenario`);
    if (c.kind === "monitoring-delivery") {
      const targets = c.targetIds, start = d.starter;
      if (d.engine !== "2" || !id.safeParse(c.resourceId).success || !z.string().min(1).max(256).safeParse(c.backendId).success ||
        !Array.isArray(targets) || targets.length < 1 || targets.length > 500 || new Set(targets).size !== targets.length || targets.some(t => !id.safeParse(t).success) ||
        ![c.minGenerated, c.minReceived].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isSafeInteger(c.maxBackendAgeUs) || c.maxBackendAgeUs < 0 ||
        !start?.resources.some(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.MonitoringAgent) ||
        targets?.some(t => !start?.resources.some(r => r.id === t && (r.type === RESOURCE_TYPES.VirtualMachine || r.type === RESOURCE_TYPES.Database)) || !start.connectionLines.some(l => l.sourceId === c.resourceId && l.targetId === t))) {
        problems.push(`${where}: monitoring-delivery needs Model 2, a named monitor/backend and connected targets, positive safe floors and a nonnegative safe age ceiling`);
      }
    }
    if (c.kind === "pool-in-service" && (d.engine !== "2" || !id.safeParse(c.resourceId).success || !Number.isSafeInteger(c.minInService) || c.minInService < 1 ||
      !d.starter?.resources.some(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.VirtualMachine && r.autoscaling?.enabled && r.autoscaling.signal !== undefined && r.autoscaling.maxReplicas! >= c.minInService))) {
      problems.push(`${where}: pool-in-service needs Model 2, its named autoscaled starter app server with a delivered-sample signal and a reachable positive floor`);
    }
    if (isDepthCriterion(c)) {
      if (d.engine !== "2" || !id.safeParse(c.resourceId).success || !depthCriterionLimits(c) || !d.starter?.resources.some(r => r.id === c.resourceId && r.type === depthResourceType(c))) problems.push(`${where}: ${c.kind} needs Model 2, its named starter resource and safe limits with positive minCompleted`);
      if (c.kind === "gateway-route-work" && (!id.safeParse(c.routeId).success || !d.starter?.resources.find(r => r.id === c.resourceId)?.apiGateway?.routes?.some(r => r.id === c.routeId))) problems.push(`${where}: gateway-route-work needs its named explicit starter route`);
    }
    if (c.kind === "firewall-admission-budget") {
      if (d.engine !== "2" || !id.safeParse(c.resourceId).success || !Number.isSafeInteger(c.minAdmissions) || c.minAdmissions < 1 ||
        !Number.isSafeInteger(c.maxPolicyDenied) || c.maxPolicyDenied < 0 || !Number.isSafeInteger(c.maxCapacityRefused) || c.maxCapacityRefused < 0 ||
        !d.starter?.resources.some(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.Firewall)) problems.push(`${where}: firewall-admission-budget needs Model 2, a named starter firewall and safe limits with positive minAdmissions`);
    }
    if (c.kind === "queue-ready-age") {
      if (d.engine !== "2" || !id.safeParse(c.resourceId).success || !Number.isFinite(c.maxAgeSeconds) || c.maxAgeSeconds < 0 ||
        !d.starter?.resources.some(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.MessageQueue && r.asyncQueue?.enabled)) problems.push(`${where}: queue-ready-age needs Model 2, its named enabled starter queue and a finite nonnegative maxAgeSeconds`);
    }
    if (c.kind === "queue-work") {
      if (d.engine !== "2" || !id.safeParse(c.resourceId).success || !Number.isSafeInteger(c.minAcknowledged) || c.minAcknowledged < 1 ||
        !Number.isSafeInteger(c.maxOutstanding) || c.maxOutstanding < 0 || !Number.isSafeInteger(c.maxRedeliveries) || c.maxRedeliveries < 0) problems.push(`${where}: queue-work needs Model 2, a queue id and safe nonnegative limits with positive minAcknowledged`);
      if (!d.starter?.resources.some(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.MessageQueue && r.asyncQueue?.enabled)) problems.push(`${where}: queue-work needs its named enabled starter queue`);
    }
    if (c.kind === "terminal-p95" && (d.engine !== "2" || !Number.isFinite(c.maxMs) || c.maxMs <= 0)) problems.push(`${where}: terminal-p95 needs Model 2 and a positive finite maxMs`);
    if (c.kind === "caller-outcomes" && (d.engine !== "2" || !Number.isSafeInteger(c.minCompleted) || c.minCompleted <= 0 || !Number.isSafeInteger(c.maxUnsuccessful) || c.maxUnsuccessful < 0)) problems.push(`${where}: caller-outcomes needs Model 2, positive safe minCompleted and nonnegative safe maxUnsuccessful`);
    if (c.kind === "backend-admission-budget" && (d.engine !== "2" || !Number.isFinite(c.maxPerOfferedRequest) || c.maxPerOfferedRequest <= 0)) problems.push(`${where}: backend-admission-budget needs Model 2 and a positive finite maxPerOfferedRequest`);
    if (c.kind === "database-connections" && c.requireSpare !== undefined && typeof c.requireSpare !== "boolean") problems.push(`${where}: criterion ${c.id} requireSpare must be boolean`);
    if (!CRITERIA.includes(c.kind)) problems.push(`${where}: criterion ${c.id} has unsupported kind ${c.kind}`);
    if (NEEDS_EXPERIMENT.has(c.kind) && !d.experiment) problems.push(`${where}: criterion ${c.id} needs an experiment`);
  }
  for (const p of d.predictions) {
    if (p.kind === "database-admission" && (d.engine !== "2" || !d.starter?.resources.some(r => r.type === RESOURCE_TYPES.Database))) problems.push(`${where}: database-admission needs Model 2 and a starter database`);
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
      if (!validateConnection(source.type, target.type, { source, target, connectionId: l.id }).valid) problems.push(`${where}: starter connection ${l.id} breaks the connection rules`);
    }
    const readiness = validateModel2Readiness(d.starter.resources, d.starter.connectionLines, { workload: d.workload });
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
  if (!problems.length) {
    try { validatedDefinitions.set(d, structuredClone(d)); }
    catch { /* Non-cloneable inputs are validated normally and never cached. */ }
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
