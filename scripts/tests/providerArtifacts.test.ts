import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateProviderProofs } from "../reality/provider-proofs";
import { providerArtifactBytes, providerRoot, providerSourceHash } from "../reality/provider-source";
test("M2I saved-product evidence and positive/negative campaigns replay without artifact growth", () => {
  const v = validateProviderProofs();

  expect(v.cases).toBe(8);

  expect(v.captures).toBe(32);

  expect(v.billing.count).toBe(1024);

  expect(v.compiler).toMatchObject({ count: 128, valid: 64, refused: 64 });

  expect(providerArtifactBytes()).toBeLessThanOrEqual(1048576);
}, 30000);
test("M2I host measurements retain source identity and explicit physical Unknown", () => {
  const p = JSON.parse(readFileSync(resolve(providerRoot, "docs/reality/m2i-performance.json"), "utf8"));

  expect(p.complete).toBe(true);

  expect(p.sourceHash).toBe(providerSourceHash());

  expect(p.billingRows).toBe(10000);

  expect(p.hostSlots).toBe(32);

  for (const key of ["compileMs", "setupMs", "runMs", "evidenceMs", "billingMs", "serializeMs"]) expect(p[key]).toBeGreaterThanOrEqual(0);

  expect(p.scope).toContain("not provider physical timing");
});
