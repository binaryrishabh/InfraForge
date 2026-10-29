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
