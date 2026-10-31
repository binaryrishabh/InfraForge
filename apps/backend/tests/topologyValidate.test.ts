import { expect, test } from "bun:test";
import { buildContractFromRunInputs, createModel2Run } from "@infraforge/simulation/internal-product";
import { runValidation } from "../stages/validate.stages";
import { captureRunInputs } from "../deployments/runInputs";
import { preflight } from "../challenges/preflight";
import { latestChallenge, listLatestChallenges } from "../challenges/registry";
import { REFERENCE } from "./challengeHarness";
import type { Resource } from "@infraforge/domain/resource";

const resources: Resource[] = ["CDN", "Load Balancer", "Virtual Machine"].map((type, i) => ({ id: `r${i}`, type: type as Resource["type"], x: 0, y: 0 }));
const connectionLines = [
  { id: "origin", sourceId: "r0", targetId: "r1", sourceType: "CDN", targetType: "Load Balancer", port: 80 },
  { id: "backend", sourceId: "r1", targetId: "r2", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
];

test("the old CDN origin fails Validate with the same reason as subsequent execution", () => {
  const input = captureRunInputs({ resources, connectionLines });
  const readiness = runValidation(input);
  const built = buildContractFromRunInputs(input, 30);
  expect(readiness.valid).toBe(false);
  expect(built).toHaveProperty("refused");
  if ("refused" in built) expect(readiness.errors).toEqual(built.refused);
  expect(() => createModel2Run(input, 30)).toThrow(readiness.errors[0]);
});

test("challenge preflight catches connected topology errors instead of offering a runnable verdict", () => {
  const result = preflight(latestChallenge("first-production-api")!.definition, { resources, connectionLines });
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("Connect the CDN to one object store; dynamic app origins need an authored HTTP plan.");
  expect(result.checks.find(c => c.id === "checks")?.status).toBe("problem");
});

test("Validate retains captured profiles without silently upgrading historical intent", () => {
  const app: Resource = { id: "app", type: "Virtual Machine", x: 0, y: 0, applicationFlow: { schema: "application-flow/2", operations: { read: { steps: [{ id: "cpu", kind: "compute" }] } } } };
  const input = captureRunInputs({ resources: [app], connectionLines: [] });
  expect(runValidation(input).valid).toBe(true);
  for (const profiles of [undefined, []]) {
    const historical = { ...input, adapterProfiles: profiles };
    const ready = runValidation(historical);
    const built = buildContractFromRunInputs(historical, 30);
    expect(ready.valid).toBe(false);
    if ("refused" in built) expect(ready.errors).toEqual(built.refused);
    else throw Error("Expected the recorded profile selection to be refused");
  }
});

test("every current Model 2 challenge starter and reference passes the authoritative Validate gate", () => {
  for (const { definition } of listLatestChallenges().filter(({ definition }) => definition.engine === "2")) {
    for (const layout of [...(definition.starter ? [definition.starter] : []), REFERENCE[definition.id]]) {
      expect(layout).toBeDefined();
      const input = captureRunInputs(layout, definition.workload);
      expect(runValidation(input)).toMatchObject({ valid: true, errors: [] });
      expect(buildContractFromRunInputs(input, definition.evaluationSeconds)).not.toHaveProperty("refused");
    }
  }
});
