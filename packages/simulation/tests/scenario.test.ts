import { expect, test } from "bun:test";
import { compileScenario, dueScenarioSteps, scenarioError } from "../src/model2Run";
import type { ChallengeScenario } from "@infraforge/contracts/challenges";
import type { FlowCall } from "@infraforge/domain/resource";
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
  const bypass = interventionInput(); bypass.connectionLines = [];
  expect(() => compileScenario(scenario, bypass, 5)).toThrow();
  const overlap = {...scenario, steps: [...scenario.steps, {...scenario.steps[0]!, id: "overlap", atSecond: 3}]};
  expect(() => compileScenario(overlap, interventionInput(), 6)).toThrow();
});
test("due steps retain author order for ties, return every due step and respect the next cursor", () => {
  const plan = {...scenario, steps: [ {...scenario.steps[0]!, id: "late", atSecond: 4}, {...scenario.steps[0]!, id: "first"}, {...scenario.steps[0]!, id: "second"}]};
  expect(dueScenarioSteps(plan, 0, 1)).toEqual([]);
  expect(dueScenarioSteps(plan, 0, 2).map(s => s.id)).toEqual(["first", "second"]);
  expect(dueScenarioSteps(plan, 1, 9).map(s => s.id)).toEqual(["second", "late"]);
});
test("serving paths follow sequential and parallel operation overrides, not inactive edges between active nodes", () => {
  const input = interventionInput();
  input.connectionLines = [];
  input.workloadProfile.readWriteRatio = 0;
  input.resources.push({id: "helper", type: "Virtual Machine", x: 2, y: 0}, {id: "service", type: "Virtual Machine", x: 3, y: 0});
  input.resources.push({id: "idle", type: "Virtual Machine", x: 4, y: 0});
  input.connectionLines.push(
    {id: "app-helper", sourceId: "app", targetId: "helper", sourceType: "Virtual Machine", targetType: "Virtual Machine", port: 80},
    {id: "app-service", sourceId: "app", targetId: "service", sourceType: "Virtual Machine", targetType: "Virtual Machine", port: 80},
    {id: "app-idle", sourceId: "app", targetId: "idle", sourceType: "Virtual Machine", targetType: "Virtual Machine", port: 80},
    {id: "helper-service", sourceId: "helper", targetId: "service", sourceType: "Virtual Machine", targetType: "Virtual Machine", port: 80},
    {id: "service-db", sourceId: "service", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432},
  );
  const app = input.resources.find(r => r.id === "app")!, helper = input.resources.find(r => r.id === "helper")!;
  helper.applicationFlow = {schema: "application-flow/1", operations: {
    write: {steps: [{id: "compute", kind: "compute"}]}, read: {steps: [{id: "db", kind: "call", edge: "helper-service"}]},
  }};
  for (const parallel of [false, true]) {
    const call: FlowCall = {id: "helper", kind: "call", edge: "app-helper", operation: "read"};
    const second = {...call, id: "second", edge: "app-idle"};
    app.applicationFlow = {schema: "application-flow/1", operations: {write: {steps: parallel ? [{id: "fanout", kind: "parallel", wait: "all", branches: [call, second]}] : [call]}}};
    expect(() => compileScenario(scenario, input, 5)).not.toThrow();
    // app and service are both active, but their direct drawn edge is never called.
    const unusedEdge = {...scenario, steps: [{...scenario.steps[0]!, request: intervention("delay", {delay: 1000, duration: 1}, {edgeId: "app-service", direction: "both"}).parameters}]};
    expect(() => compileScenario(unusedEdge, input, 5)).toThrow("serving path");
    if (parallel) helper.applicationFlow.operations.read = {steps: [{id: "compute", kind: "compute"}]};
    else call.operation = "write";
    expect(() => compileScenario(scenario, input, 5)).toThrow("serving path");
  }
});
test("malformed, excessive, duplicate, fractional and late scripts are refused", () => {
  expect(scenarioError(scenario, 5)).toBeNull();
  for (const steps of [[], Array(21).fill(scenario.steps[0]), [scenario.steps[0], scenario.steps[0]], [{...scenario.steps[0], atSecond: 1.5}], [{...scenario.steps[0], atSecond: 3}]]) {
    expect(scenarioError({...scenario, steps}, 5)).not.toBeNull();
  }
});
