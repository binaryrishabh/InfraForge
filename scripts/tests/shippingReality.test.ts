import { expect, test } from "bun:test";
import { invalidUi, newInventoryEntry, scanSurface, shippingInventory, unshippable, validateShipping, visibleSurfaces } from "../reality/shipping-inventory";
import { reviewM2g } from "../reality/shipping-taxonomy";
test("every infrastructure field, resource, chaos option and scanned visible control has a shipping entry", () => {
  const entries = shippingInventory().entries; expect(validateShipping(entries)).toEqual([]); expect(entries.length).toBeGreaterThan(400);
  for (const field of ["public", "encryption", "openPorts", "size", "region", "skuId", "autoscaling"]) expect(entries.some((e) => e.identity === `Resource.${field}`)).toBe(true);
  expect(entries.filter((e) => e.kind === "resource")).toHaveLength(11); expect(entries.filter((e) => e.kind === "chaos")).toHaveLength(5);
  expect(unshippable(entries).length).toBeGreaterThan(0); expect(entries.find((e) => e.identity === "Resource.public")!.finalProductEligible).toBe(false);
});
test("ordinary UI actions do not require physics; missing behavior proof is a separate gate", () => {
  const entries = shippingInventory().entries;
  const close = entries.find((e) => e.description.includes("onClick={() => onOpenChange(false)}"))!;
  expect(close.category).toBe("PRODUCT_UI_ACTION"); expect(unshippable([close])).toEqual([]);
  expect(invalidUi([close])).toHaveLength(1);
  const pan = entries.find((e) => e.description.includes("viewport.handlePanStart"))!;
  expect(pan.category).toBe("PRESENTATION_ONLY");
  expect(reviewM2g({ ...close, kind: "field", identity: "Resource.public" })).toBe("SECURITY_CONTROL");
  const publicField = entries.find((e) => e.identity === "Resource.public")!;
  expect(validateShipping(entries.map((e) => e === publicField ? { ...e, category: "PRODUCT_UI_ACTION" } : e)).some((e) => e.includes("misclassified"))).toBe(true);
});
test("a future visible toggle or resource field cannot silently escape inventory coverage", () => {
  const entries = shippingInventory().entries, added = scanSurface("future.tsx", 'export const New = () => <NewSecuritySwitch checked={enabled} onChange={setEnabled} />');
  expect(added).toHaveLength(1); expect(validateShipping(entries, [...visibleSurfaces(), ...added]).some((e) => e.includes("Inventory gap"))).toBe(true);
  expect(newInventoryEntry(added[0]!)).toMatchObject({ status: "UNKNOWN", finalProductEligible: false, changesState: false });
  expect(scanSurface("resource.ts", "interface Resource { magicSecurity: boolean }")[0]!.identity).toBe("Resource.magicSecurity");
});
test("partial controls cannot be promoted by changing only the shipping boolean", () => {
  const entries = shippingInventory().entries, row = entries.find((e) => e.identity === "Resource.encryption")!;
  const mutated = entries.map((e) => e === row ? { ...e, finalProductEligible: true } : e);
  expect(validateShipping(mutated).some((e) => e.includes("Unsupported shipping eligibility"))).toBe(true);
});
