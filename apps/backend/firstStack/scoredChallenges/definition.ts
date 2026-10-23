import type { FirstStackSidecarV2 } from "@infraforge/contracts/first-stack";
import source from "./lose-an-app-server.v2.json";
import redirect from "./url-redirect.v2.json";
import catalogue from "./catalogue-api.v2.json";
import reviews from "./reviews-api.v2.json";
import paste from "./small-paste-api.v2.json";
import news from "./preloaded-news-api.v2.json";
import history from "./price-history-api.v2.json";
import { canonical, designRevision, hash } from "../canonical";
import { prepareFirstStackExecution } from "../execution";
import { resolveWorkload } from "../workload";
import { ConflictError, ValidationError } from "../../utils/errors";
import { reviewSidecar } from "../authoring";
import { challengeDefinitionSchema, type ChallengeDefinition, type ChallengeWorkload } from "./schema";
import { readPrivateBundle, configuredScoringDirectory, ScoringUnavailableError } from "./privateStore";
export { challengeDefinitionSchema } from "./schema";
export type { ChallengeDefinition, ChallengeWorkload, ChallengeCriterion, ScoringDefinition } from "./schema";

export interface ChallengeReference { id: string; version: string; definitionHash: string }

// A registry binds reviewed public commitments to one server-owned store.
// Tests construct a separate fake registry; production never imports fixtures.
export function createChallengeRegistry(sources: unknown[], directory: () => string | undefined) {
  function definition(id: string, version: string): ChallengeDefinition {
    const selected = sources.find(value => {
      const d = value as { id?: string; version?: string };
      return d.id === id && d.version === version;
    });
    if (!selected) throw new ValidationError("Scored challenge version unavailable");
    return challengeDefinitionSchema.parse(selected) as unknown as ChallengeDefinition;
  }
  function scoring(reference: ChallengeReference) {
    const selected = definition(reference.id, reference.version);
    if (hash(selected) !== reference.definitionHash) throw new ConflictError("Pinned scored challenge definition unavailable");
    const bundle = readPrivateBundle(selected, directory());
    if (bundle.hidden.some(w => [selected.visible.id, ...selected.practice.map(p => p.workload.id)].includes(w.id))) {
      throw new ScoringUnavailableError();
    }
    return { ...selected, hidden: bundle.hidden as ChallengeWorkload[], rubric: bundle.rubric };
  }
  return { definition, scoring };
}
export type ChallengeRegistry = ReturnType<typeof createChallengeRegistry>;
export const serverChallenges = createChallengeRegistry([source, redirect, catalogue, reviews, paste, news, history], configuredScoringDirectory);
export const challengeDefinition = serverChallenges.definition;
export const pinnedChallenge = serverChallenges.scoring;

export async function prepareChallengeWorkload(owner: string, layout: Record<string, unknown>, definition: ChallengeDefinition, workload: ChallengeWorkload) {
  const candidate = structuredClone(layout.firstStack) as FirstStackSidecarV2;
  candidate.workload = null;
  candidate.faults = structuredClone(workload.faults);
  async function* bytes() { yield new TextEncoder().encode([workload.header, ...workload.rows].map(row => JSON.stringify(row)).join("\n") + "\n"); }
  const schedule = await resolveWorkload(bytes(), { owner, sidecar: candidate, parameters: workload.parameters });
  candidate.workload = { scheduleHash: schedule.scheduleHash, parametersHash: schedule.parametersHash,
    resolvedIdentity: schedule.identity, executedScheduleHash: schedule.executedScheduleHash };
  return prepareFirstStackExecution(owner, layout, candidate, schedule, { ...definition.policy, seed: workload.seed ?? definition.policy.seed, maxRawResults: Math.min(definition.policy.maxRawResults, schedule.rows.length) });
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
export async function admitScoredChallenge(owner: string, layout: Record<string, unknown>, reference: { id: string; version: string }, workload: unknown, policy: unknown, registry: ChallengeRegistry = serverChallenges) {
  const definition = registry.definition(reference.id, reference.version);
  validateChallengeDesign(layout, definition);
  const prepared = await prepareChallengeWorkload(owner, layout, definition, definition.visible);
  if (canonical(workload) !== canonical(prepared.schedule) || canonical(policy) !== canonical(prepared.policy) ||
    hash(layout.firstStack) !== hash(prepared.sidecar)) throw new ValidationError("Submit the exact server-owned visible sample and policy");
  return { prepared, reference: { id: definition.id, version: definition.version, definitionHash: hash(definition) } };
}
// A deliberately enumerated client projection: no registry spread or raw JSON.
export async function publicChallenge(owner: string, id: string, version: string, registry: ChallengeRegistry = serverChallenges) {
  const definition = registry.definition(id, version), sidecar = structuredClone(definition.template.sidecar);
  sidecar.designRevision = designRevision(definition.template.layout);
  const layout = { ...definition.template.layout, firstStack: sidecar };
  const prepared = await prepareChallengeWorkload(owner, layout, definition, definition.visible);
  return { schema: "infraforge-scored-challenge-sample/1", id, version, brief: definition.brief, constraints: definition.constraints,
    layout: { ...layout, firstStack: prepared.sidecar }, workload: prepared.schedule, policy: prepared.policy };
}
