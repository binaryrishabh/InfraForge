import { expect, test } from "bun:test";
import { compileScenario, dueScenarioSteps, scenarioError } from "../src/model2Run";
import type { ChallengeScenario } from "@infraforge/contracts/challenges";
import { intervention, interventionInput } from "./interventionFixture";

const scenario: ChallengeScenario = {version: 1, visibility: "revealed", steps: [
  {id: "db-slow", atSecond: 2, request: intervention("cpu-capacity", {cores: 0.02, duration: 2}).parameters},
]};
test("whole script precompiles exact targets and microsecond boundaries without advancing a run", () => {
  const receipts = compileScenario(scenario, interventionInput(), 5);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({actionId: "a1", atUs: 2_000_001, endUs: 4_000_001});
  expect(receipts[0]!.resolvedTargets.length).toBeGreaterThan(0);
  const missing = structuredClone(scenario); missing.steps[0]!.request.target = {resourceId: "missing"};
  expect(() => compileScenario(missing, interventionInput(), 5)).toThrow();
  const overlap = {...scenario, steps: [...scenario.steps, {...scenario.steps[0]!, id: "overlap", atSecond: 3}]};
  expect(() => compileScenario(overlap, interventionInput(), 6)).toThrow();
});
test("due steps retain author order for ties, return every due step and respect the next cursor", () => {
  const plan = {...scenario, steps: [ {...scenario.steps[0]!, id: "late", atSecond: 4}, {...scenario.steps[0]!, id: "first"}, {...scenario.steps[0]!, id: "second"}]};
  expect(dueScenarioSteps(plan, 0, 1)).toEqual([]);
  expect(dueScenarioSteps(plan, 0, 2).map(s => s.id)).toEqual(["first", "second"]);
  expect(dueScenarioSteps(plan, 1, 9).map(s => s.id)).toEqual(["second", "late"]);
});
test("malformed, excessive, duplicate, fractional and late scripts are refused", () => {
  expect(scenarioError(scenario, 5)).toBeNull();
  for (const steps of [[], Array(21).fill(scenario.steps[0]), [scenario.steps[0], scenario.steps[0]], [{...scenario.steps[0], atSecond: 1.5}], [{...scenario.steps[0], atSecond: 3}]]) {
    expect(scenarioError({...scenario, steps}, 5)).not.toBeNull();
  }
});
