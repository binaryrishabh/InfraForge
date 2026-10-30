import { expect, test } from "bun:test";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { design } from "./asyncCanvas.fixture";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { withRunLength } from "../src/model2/product/runContract";

test("/3 compute-only read flows with ordinary queues pass readiness, compilation and execution", () => {
  for (const enabled of [undefined, false]) {
    const d = design(false, 1);
    d.workload.readWriteRatio = 1;
    d.resources[0]!.applicationFlow = { schema: "application-flow/3", operations: {
      read: { steps: [{ id: "cpu", kind: "compute" }] },
    } };
    if (enabled === false) d.resources[1]!.asyncQueue = {
      enabled, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300,
    };
    const built = contractFromDesign(d);
    if ("refused" in built) throw Error(JSON.stringify(built.refused));
    const compiled = compileProduct(d, withRunLength(built.contract, 4, "flow-readiness"));
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const runtime = createProductModel2(compiled.value);
    runtime.advanceTo(4000000);
    expect(runtime.evidence().counts.completed).toBe(4);
    expect(validateDeploymentReadiness(d.resources, d.connections)).toMatchObject({ valid: true, errors: [] });
  }
});

test("/3 enabled upload queues without a publish step remain refused", () => {
  const d = design(true, 1);
  d.resources[0]!.applicationFlow = { schema: "application-flow/3", operations: {
    write: { steps: [{ id: "cpu", kind: "compute" }] },
  } };
  expect(validateDeploymentReadiness(d.resources, d.connections)).toMatchObject({
    valid: false,
    errors: ["e0: This upload queue needs an Application Flow publish step on the source VM"],
  });
  expect(contractFromDesign(d)).toHaveProperty("refused");
  d.resources[0]!.applicationFlow.operations.write!.steps.push({ id: "send", kind: "publish", edge: "e0" });
  expect(validateDeploymentReadiness(d.resources, d.connections)).toMatchObject({ valid: true, errors: [] });
  expect(contractFromDesign(d)).not.toHaveProperty("refused");
});
