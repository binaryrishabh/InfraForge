import { expect, test } from "bun:test";
import { retainedProductProofs, replayProductCompilation, validateProductArtifacts } from "../reality/product-artifacts";
import { compactProductEvidence } from "../reality/product-proofs";
import { productHash } from "../reality/product-source";
import { createProductModel2 } from "../../packages/simulation/src/model2/product/run";
import { presentModel2 } from "../../packages/simulation/src/model2/product/presentation";
import { checkProduct } from "../reality/product-cases";
import { LayoutSchema } from "../../apps/backend/zod_schemas/layout.schema";
import { WorkloadProfileSchema } from "../../apps/backend/zod_schemas/deployment.schema";
test("proof inputs satisfy the actual persisted product layout and workload schemas", () => {
  for (const c of retainedProductProofs().cases) {
    expect(LayoutSchema.safeParse({ resources: c.design.resources, connectionLines: c.design.connections }).success).toBe(true);
    expect(WorkloadProfileSchema.safeParse(c.design.workload).success).toBe(true);
  }
});
test("all six retained product artifacts have exact-source provenance and deterministic compilation", () => {
  expect(validateProductArtifacts()).toEqual([]); expect(replayProductCompilation()).toEqual([]);
}, 20000);
test("retained product proofs replay actual lifecycle/ownership and the evidence presentation contract", () => {
  for (const c of retainedProductProofs().cases) { const r = createProductModel2(c.compiled); r.advanceTo(80000); checkProduct(r.evidence()); expect(productHash(compactProductEvidence(r.evidence()))).toBe(productHash(c.cut)); r.advanceTo(r.horizon); const e = r.evidence(); checkProduct(e); expect(productHash(compactProductEvidence(e))).toBe(productHash(c.final)); expect(productHash(presentModel2(e))).toBe(productHash(c.presentation)); }
}, 30000);
test("retained mechanism evidence demonstrates scale-out, recovery, observed-data hold and finite creation budget", () => {
  const cases = retainedProductProofs().cases, normal = cases.find((c) => c.name === "normal")!, outage = cases.find((c) => c.name === "registry-outage")!, observed = cases.find((c) => c.name === "stale-telemetry")!;
  expect(normal.final.product.controllers[0]!.populations.terminated).toBeGreaterThan(0);
  expect(outage.cut.product.controllers[0]!.desired).toBeGreaterThan(outage.cut.product.controllers[0]!.inService);
  expect(observed.cut.product.controllers[0]!.events.some((e) => e.kind === "signal-missing" && e.at >= 60000)).toBe(true);
  expect(observed.cut.systems.backends[0]!.samples.every((s) => s.measurementAt <= 45000)).toBe(true);
  expect(normal.cut.systems.backends[0]!.samples.some((s) => s.measurementAt > 70000)).toBe(true);
});
