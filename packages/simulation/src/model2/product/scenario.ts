import { interventionError } from "@infraforge/domain/resource";
import type { ChallengeScenario } from "@infraforge/contracts/challenges";
import { compileProduct } from "./compiler";
import { withTimeline } from "./timeline";
import { buildContractFromRunInputs, type CapturedModel2Input } from "./runContract";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: object) => Object.keys(v).sort().join();
// Authored order breaks ties. Both hosts use this helper before advancing another tick.
export function orderedScenarioSteps(scenario: ChallengeScenario) {
  return [...scenario.steps].sort((a, b) => a.atSecond - b.atSecond);
}
export function dueScenarioSteps(scenario: ChallengeScenario, next: number, second: number) {
  return orderedScenarioSteps(scenario).slice(next).filter(step => step.atSecond <= second);
}
export function scenarioError(value: unknown, evaluationSecond: number): string | null {
  if (!object(value) || keys(value) !== "steps,version,visibility" || value.version !== 1 || !["revealed", "debrief"].includes(value.visibility as string) ||
    !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 20) return "A scenario needs version 1, visibility and 1 to 20 steps.";
  const ids = new Set<string>();
  for (const step of value.steps) {
    if (!object(step) || keys(step) !== "atSecond,id,request" || typeof step.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(step.id) || ids.has(step.id) ||
      !Number.isSafeInteger(step.atSecond) || Number(step.atSecond) < 1 || Number(step.atSecond) >= evaluationSecond) return "Scenario steps need unique stable ids and whole seconds before evaluation.";
    ids.add(step.id);
    const error = interventionError(step.request, {remainingSeconds: evaluationSecond - Number(step.atSecond) - 1});
    if (error) return error;
    const request = step.request as ChallengeScenario["steps"][number]["request"];
    const duration = Number(request.parameters.duration ?? 0);
    if (Number(step.atSecond) + duration >= evaluationSecond) return "Scenario effects must end before evaluation.";
  }
  return null;
}
// Compile the ENTIRE script, including future overlaps, against exactly the captured topology.
// No engine is advanced and no alternative target is selected.
export function compileScenario(scenario: ChallengeScenario, input: CapturedModel2Input, evaluationSecond: number) {
  const error = scenarioError(scenario, evaluationSecond);
  if (error) throw Error(error);
  const built = buildContractFromRunInputs(input, evaluationSecond);
  if ("refused" in built) throw Error(built.refused.join(" "));
  const design = {schema: "infraforge-saved-design/1" as const, resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile};
  const contract = withTimeline(built.contract, orderedScenarioSteps(scenario).map((step, i) => ({id: `a${i + 1}`, kind: "intervention", atUs: step.atSecond * 1_000_000 + 1, request: step.request})));
  const compiled = compileProduct(design, contract);
  if (!compiled.ok) throw Error(compiled.diagnostics.map(d => d.message).join(" "));
  return compiled.value.interventionReceipts ?? [];
}
