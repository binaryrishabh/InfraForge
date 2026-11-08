import { expect, test } from "bun:test";
import { reviewDesignChanges } from "../challenges/designChanges";
import { captureRunInputs } from "../deployments/runInputs";
import { tier } from "./challengeHarness";

// The designer's Instance size choices must read as ONE change in the guided one-change review.
// Choosing a catalog size patches only skuId (it overrides a saved generic size); a generic choice patches only size.
test("a catalog or generic size choice counts as one design change, while also clearing the other field would count two", () => {
  const base = captureRunInputs(tier(2), undefined, "fixed");
  const index = base.resources.findIndex(r => r.type === "Virtual Machine");
  const edit = (patch: Record<string, unknown>) => { const next = structuredClone(base); Object.assign(next.resources[index]!, patch); return next; };
  const generic = edit({ size: "small", skuId: undefined }), withCatalog = edit({ size: "small", skuId: "c5.large" }), medium = edit({ size: "medium", skuId: undefined });
  expect(reviewDesignChanges(generic, withCatalog)).toMatchObject({ classification: "one-change", count: 1 });
  expect(reviewDesignChanges(generic, medium)).toMatchObject({ classification: "one-change", count: 1 });
  // The shape the inspector used to produce (SKU set and generic size cleared) is two factual edits.
  const old = edit({ size: undefined, skuId: "c5.large" });
  expect(reviewDesignChanges(generic, old).count).toBe(2);
});
