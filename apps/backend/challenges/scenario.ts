import type { ChallengeDefinition, RecordedScenario } from "@infraforge/contracts/challenges";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { compileScenario } from "@infraforge/simulation/model2-run";
import { specHash } from "./registry";

export function recordedScenario(definition: ChallengeDefinition, input: RunInputs): RecordedScenario | null {
  if (!definition.scenario) return null;
  if (definition.experiment || definition.engine !== "2" || input.version !== 2 || input.simulationModelVersion !== "2") throw Error("Scenarios require Model 2 and cannot include a legacy experiment.");
  const plan: RecordedScenario = {...structuredClone(definition.scenario), definitionHash: specHash(definition), simulationModelVersion: "2", catalogSnapshot: input.catalogSnapshot,
    adapterProfiles: [...(input.adapterProfiles ?? [])], receipts: compileScenario(definition.scenario, input, definition.evaluationSeconds)};
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
