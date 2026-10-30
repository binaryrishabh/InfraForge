import { interventionError } from "@infraforge/domain/resource";
import type { ChallengeScenario } from "@infraforge/contracts/challenges";
import { compileProduct } from "./compiler";
import { withTimeline } from "./timeline";
import { buildContractFromRunInputs, type CapturedModel2Input } from "./runContract";
import { rateRows } from "../workload/arrivals";
import type { SystemsInput } from "../systems/contracts";

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
  const {resources, paths} = servingPath(compiled.value.input);
  for (const [i, step] of orderedScenarioSteps(scenario).entries()) {
    const receipt = compiled.value.interventionReceipts![i]!;
    const active = "resourceId" in step.request.target && step.request.interventionId !== "deny-port"
      ? receipt.resolvedTargets.some(id => resources.has(id))
      : receipt.affectedPaths.some(id => paths.has(id));
    if (!active) throw Error(`Scenario step ${step.id} must stay on the captured serving path for an offered operation.`);
  }
  return compiled.value.interventionReceipts ?? [];
}

// Follow compiled calls, including operation overrides and replica expansion. A drawn
// edge (or a health probe) alone does not put a target on the workload's serving path.
function servingPath(input: SystemsInput) {
  const resources = new Set<string>(), paths = new Set<string>(), seen = new Set<string>();
  const nodes = new Map(input.resources.map(r => [r.id, r]));
  const visit = (id: string, operation: string, source: string) => {
    for (const path of input.paths) if (path.source === source && path.target === id) paths.add(path.id);
    const key = JSON.stringify([id, operation]);
    if (seen.has(key)) return;
    seen.add(key); resources.add(id);
    const node = nodes.get(id);
    const call = (target: string, op = operation) => visit(target, op, id);
    if (node?.kind === "load-balancer" || node?.kind === "router") node.backends.forEach(target => call(target));
    else if (node?.kind === "compute") {
      const flow = node.applicationFlow?.operations[operation];
      if (flow) for (const step of flow.steps) {
        if (step.kind === "call") call(step.target, step.operation ?? operation);
        else if (step.kind === "parallel") for (const branch of step.branches) call(branch.target, branch.operation ?? operation);
      }
      else { const target = node.downstreamByOperation?.[operation] ?? node.downstream; if (target) call(target); }
    } else if (node?.kind === "cache-aside" && node.operations[operation]) {
      call(node.database);
      if (node.operations[operation] === "read" || node.invalidateWrites) call(node.cache);
    } else if (node?.kind === "cdn") call(node.origin);
    else if (node?.kind === "dns-resolver") call(node.authority);
    else if (node?.kind === "registry") call(node.store);
  };
  const offered = new Set<string>();
  for (const source of input.arrivals) {
    if (source.kind === "rate") for (const row of rateRows(source.rate)) offered.add(row.operation);
    else if (source.kind === "trace") source.trace.rows.forEach(row => offered.add(row.operation));
    else offered.add(source.operation);
  }
  for (const operation of input.operations) if (offered.has(operation.id)) visit(operation.entry, operation.id, "$caller");
  return {resources, paths};
}
