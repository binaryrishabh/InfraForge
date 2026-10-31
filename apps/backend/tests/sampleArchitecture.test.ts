import { expect, test } from "bun:test";
import { SAMPLE_ARCHITECTURE } from "@infraforge/domain/examples";
import { validateConnection, validateDeploymentReadiness } from "@infraforge/domain/validation";
import { buildContractFromRunInputs, compileProduct, createProductModel2, type SavedProductDesign } from "@infraforge/simulation/internal-product";
import { captureRunInputs } from "../deployments/runInputs";
import { runValidation } from "../stages/validate.stages";

test("the user-facing sample is drawable and runs through captured Model 2 inputs", () => {
  const input = captureRunInputs({ ...SAMPLE_ARCHITECTURE, layoutVersion: 3 }, undefined, "sample-architecture");
  const built = buildContractFromRunInputs(input, 2);
  if ("refused" in built) throw Error(`Model 2 refuses the sample: ${built.refused.join(" ")}`);
  expect(runValidation(input)).toEqual({ valid: true, errors: [], warnings: [] });
  expect(validateDeploymentReadiness(input.resources, input.connectionLines)).toEqual({ valid: true, errors: [], warnings: [] });
  for (const line of input.connectionLines) {
    const source = input.resources.find(resource => resource.id === line.sourceId)!;
    const target = input.resources.find(resource => resource.id === line.targetId)!;
    expect(validateConnection(source.type, target.type, "draw").valid).toBe(true);
  }
  const design: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile };
  const compiled = compileProduct(design, built.contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const runtime = createProductModel2(compiled.value);
  runtime.advanceTo(1_000_000);
  expect(runtime.evidence().counts.completed).toBeGreaterThan(0);
});
