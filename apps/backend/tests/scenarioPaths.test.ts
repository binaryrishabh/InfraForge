import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { boundRetriesDuringSlowdownV1 as d } from "../challenges/definitions/bound-retries-during-slowdown/v1";
import { captureRunInputs } from "../deployments/runInputs";
import { recordedScenario } from "../challenges/scenario";
import { preflight } from "../challenges/preflight";
import { validateChallengeVersions } from "../challenges/validate";

function race(): ChallengeStarter {
  return {resources: [
    {id: "lb", type: "Load Balancer", x: 0, y: 0, retry: {enabled: false}},
    {id: "app", type: "Virtual Machine", x: 1, y: 0, applicationFlow: {schema: "application-flow/1", operations: {read: {steps: [
      {id: "race", kind: "parallel", wait: 1, branches: [{id: "fast", kind: "call", edge: "app-fast"}, {id: "slow", kind: "call", edge: "app-slow"}]},
    ]}}}},
    {id: "fast", type: "Virtual Machine", x: 2, y: 0},
    {id: "slow", type: "Virtual Machine", x: 2, y: 1, applicationFlow: {schema: "application-flow/1", operations: {read: {steps: [
      {id: "compute", kind: "compute"}, {id: "data", kind: "call", edge: "slow-data"},
    ]}}}},
    {id: "data", type: "Virtual Machine", x: 3, y: 1}, {id: "db", type: "Database", x: 4, y: 1},
  ], connectionLines: [
    {id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80},
    ...[["app-fast", "app", "fast"], ["app-slow", "app", "slow"], ["slow-data", "slow", "data"]].map(([id, sourceId, targetId]) =>
      ({id: id!, sourceId: sourceId!, targetId: targetId!, sourceType: "Virtual Machine" as const, targetType: "Virtual Machine" as const, port: 80})),
    {id: "data-db", sourceId: "data", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432},
  ]};
}

test("quorum-only database paths refuse authoring and preflight, including nested cancellation", () => {
  const definition = {...d, workload: {...d.workload, targetThroughput: 600}};
  const design = race(), app = design.resources.find(r => r.id === "app")!;
  const parallel = app.applicationFlow!.operations.read!.steps[0]!;
  if (parallel.kind !== "parallel") throw Error("Expected fixture parallel step");
  const record = () => recordedScenario(definition, captureRunInputs(design, definition.workload));
  expect(record).toThrow("serving path");
  expect(preflight(definition, design).errors.join()).toContain("serving path");
  expect(validateChallengeVersions([{...definition, starter: design}], {}).join()).toContain("serving path");
  for (const wait of ["all", 2] as const) { parallel.wait = wait; expect(record).not.toThrow(); }
  // An independent LB path is outside the cancellable branches, even when the
  // same resource also occurs in a quorum branch.
  parallel.wait = 1;
  design.connectionLines.push({id: "required", sourceId: "lb", targetId: "slow", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80});
  expect(record).not.toThrow();
  design.connectionLines.pop();
  // A path guaranteed by an actually offered operation is sufficient; an
  // unoffered operation cannot rescue the read-only quorum path.
  app.applicationFlow!.operations.write = {steps: [{id: "required", kind: "call", edge: "app-slow", operation: "read"}]};
  expect(record).toThrow("serving path");
  const mixed = {...definition, workload: {...definition.workload, readWriteRatio: 0.5}};
  expect(() => recordedScenario(mixed, captureRunInputs(design, mixed.workload))).not.toThrow();
  parallel.wait = "all";
  design.connectionLines.push({id: "slow-fast", sourceId: "slow", targetId: "fast", sourceType: "Virtual Machine", targetType: "Virtual Machine", port: 80});
  design.resources.find(r => r.id === "slow")!.applicationFlow = {schema: "application-flow/1", operations: {read: {steps: [
    {id: "nested", kind: "parallel", wait: 1, branches: [{id: "data", kind: "call", edge: "slow-data"}, {id: "fast", kind: "call", edge: "slow-fast"}]},
  ]}}};
  expect(record).toThrow("serving path");
});
