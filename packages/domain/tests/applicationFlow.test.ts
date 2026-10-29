import { test, expect } from "bun:test";
import { applicationFlowError, type ApplicationFlow } from "../src/resource";
const valid = (): ApplicationFlow => ({ schema: "application-flow/1", operations: { read: { steps: [{ id: "cpu", kind: "compute" }, { id: "join", kind: "parallel", wait: 2, branches: [{ id: "a", kind: "call", edge: "edge-a" }, { id: "b", kind: "call", edge: "edge-b" }] }] } } });
test("flow v1 accepts only bounded persisted steps and single-call branches", () => {
  expect(applicationFlowError("Virtual Machine", undefined)).toBeUndefined();
  expect(applicationFlowError("Virtual Machine", valid())).toBeUndefined();
  expect(applicationFlowError("Database", valid())).toContain("Virtual Machine");
  for (const patch of [
    { steps: [] }, { steps: [{ id: "return", kind: "return" }] },
    { steps: [{ id: "p", kind: "parallel", wait: 1, branches: [] }] },
    { steps: [{ id: "p", kind: "parallel", wait: 1, branches: [{ id: "c", kind: "compute" }, { id: "b", kind: "call", edge: "b" }] }] },
    { steps: [{ id: "p", kind: "parallel", wait: 3, branches: [{ id: "a", kind: "call", edge: "a" }, { id: "b", kind: "call", edge: "b" }] }] },
    { steps: Array.from({length: 33}, (_, i) => ({id: `cpu${i}`, kind: "compute"})) },
    { steps: [{id:"a",kind:"call",edge:"e"},{id:"a",kind:"compute"}] },
  ]) expect(applicationFlowError("Virtual Machine", { ...valid(), operations: { read: patch } })).toBeDefined();
});


import { validateConnection, validateDeploymentReadiness } from "../src/validation";
import type { Resource } from "../src/resource";
test("service edges preserve the pre-flow invalid verdict until the source flow calls that exact edge", () => {
  for (const type of ["Virtual Machine", "Load Balancer"] as const) {
    const source: Resource = { id: "app", type: "Virtual Machine", x: 0, y: 0 };
    const target: Resource = { id: "target", type, x: 0, y: 0 };
    const edge = { id: "call", sourceId: source.id, targetId: target.id, sourceType: source.type, targetType: type, port: 80 };
    // Pre-flow rule excluded both targets: starter connection-rule failures must remain failures.
    expect(validateConnection(source.type, type).valid).toBe(false);
    expect(validateConnection(source.type, type).message).toContain("This connection is used only by an Application Flow");
    expect(validateDeploymentReadiness([source, target], [edge]).valid).toBe(false);
    expect(validateConnection(source.type, type, "draw").valid).toBe(true);
    source.applicationFlow = { schema: "application-flow/1", operations: { read: { steps: [{ id: "c", kind: "call", edge: "other" }] } } };
    expect(validateDeploymentReadiness([source, target], [edge]).valid).toBe(false);
    source.applicationFlow.operations.read!.steps = [{ id: "p", kind: "parallel", wait: 1, branches: [{ id: "c", kind: "call", edge: "call" }, { id: "d", kind: "call", edge: "other" }] }];
    expect(validateDeploymentReadiness([source, target], [edge]).valid).toBe(true);
    expect(validateConnection(source.type, type, { source, connectionId: edge.id }).valid).toBe(true);
    expect(validateConnection(source.type, type, { source: target, connectionId: edge.id }).valid).toBe(false);
  }
});
