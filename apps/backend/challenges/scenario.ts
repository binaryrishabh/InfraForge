import type { ChallengeDefinition, RecordedScenario } from "@infraforge/contracts/challenges";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { compileScenario } from "@infraforge/simulation/model2-run";
import { specHash } from "./registry";
import { createHash } from "node:crypto";
import { databaseRecoveryPlanError } from "@infraforge/domain/resource";

export function recordedScenario(definition: ChallengeDefinition, input: RunInputs): RecordedScenario | null {
  if (!definition.scenario) return null;
  if (definition.experiment || definition.engine !== "2" || input.version !== 2 || input.simulationModelVersion !== "2") throw Error("Scenarios require Model 2 and cannot include a legacy experiment.");
  const scenario = structuredClone(definition.scenario), recovery = scenario.databaseRecovery;
  let recoveryPlanHash: string | undefined;
  if (recovery) {
    if (scenario.steps.some(s => s.request.interventionId === "db-promote-replica" || s.id === "learner-promotion")) throw Error("The promotion step belongs to the learner's saved recovery plan.");
    const target = input.resources.find(r => r.id === recovery.resourceId), choice = target?.databaseRecoveryPlan;
    const error = databaseRecoveryPlanError(target?.type ?? "", choice);
    if (error || !target || !choice) throw Error(error ?? "Save a recovery plan on the challenge's database before running.");
    if (input.resources.some(r => r.id !== target.id && r.databaseRecoveryPlan !== undefined)) throw Error("Only the declared recovery target may carry a recovery plan.");
    if (choice.promoteAtSecond !== null) scenario.steps.push({id: "learner-promotion", atSecond: choice.promoteAtSecond,
      request: {interventionId: "db-promote-replica", revision: 1, target: {resourceId: target.id}, parameters: {}}});
    scenario.steps.sort((a, b) => a.atSecond - b.atSecond);
    recoveryPlanHash = createHash("sha256").update(JSON.stringify({version: 1, targetResourceId: target.id, plan: choice})).digest("hex");
  }
  const plan: RecordedScenario = {...scenario, ...(recoveryPlanHash === undefined ? {} : {recoveryPlanHash}), definitionHash: specHash(definition), simulationModelVersion: "2", catalogSnapshot: input.catalogSnapshot,
    adapterProfiles: [...(input.adapterProfiles ?? [])], receipts: compileScenario(scenario, input, definition.evaluationSeconds)};
  // Indented UTF-8 JSON conservatively includes JSONB's separator whitespace.
  // Check the entire stored value, since individually bounded receipts can add up.
  if (Buffer.byteLength(JSON.stringify(plan, null, 1), "utf8") > 65_536) {
    throw Error("SCENARIO_PLAN_BUDGET: The serialized scenario plan exceeds 65,536 bytes. Reduce its steps or target expansion.");
  }
  return plan;
}

export function verifiedScenario(value: unknown, definition: ChallengeDefinition, input: RunInputs): RecordedScenario {
  const expected = recordedScenario(definition, input);
  if (!expected || !sameScenarioValue(value, expected)) throw Error("The stored scenario does not match its definition and captured topology.");
  return expected;
}
// JSONB key order is irrelevant; array order (including tied steps) is significant.
export function sameScenarioValue(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ?
    `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}` : JSON.stringify(v);
  return canonical(a) === canonical(b);
}
