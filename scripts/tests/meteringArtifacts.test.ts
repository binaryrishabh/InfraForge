import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateMeteringProofs } from "../reality/metering-proofs";
import { meteringArtifactBytes, meteringRoot, meteringSourceHash } from "../reality/metering-source";
import { readLineage, sourceProjection, historicalFoundationHash, historicalProviderHash } from "../reality/source-lineage";
import { historicalMeteringHash } from "../metering-lineage";

test("M2J source-pinned actual product usage and all 165 cuts replay within the shared retention budget", () => {
  expect(validateMeteringProofs()).toMatchObject({ cases: 5, cuts: 165 });
  expect(meteringArtifactBytes()).toBeLessThanOrEqual(1048576);
}, 30000);
test("accepted M2J executor measurements retain historical source identity and bounded overflow", () => {
  const p = JSON.parse(readFileSync(resolve(meteringRoot, "docs/reality/m2j-performance.json"), "utf8"));
  expect(p.sourceHash).toBe(historicalMeteringHash()); expect(p.complete).toBe(true);
  expect(meteringSourceHash()).not.toBe(p.sourceHash);
  for (const key of ["compileMs", "setupMs", "runMs", "captureMs", "frameMs", "serializeMs", "replayMs"]) expect(p[key]).toBeGreaterThanOrEqual(0);
  expect(p.overflow.complete).toBe(false); expect(p.overflow.retained.records).toBe(1); expect(p.scope).toContain("not provider physical timing");
});
test("accepted source projection rejects changed originals, changed current source and unapproved mappings", () => {
  const lineage = readLineage(), read = (p: string) => readFileSync(resolve(meteringRoot, p), "utf8");
  expect(historicalFoundationHash()).toBe(lineage.foundationHash); expect(historicalProviderHash()).toBe(lineage.providerHash);
  const original = structuredClone(lineage); original.files[0]!.originalText += "\n// drift";
  expect(() => sourceProjection(original, read)).toThrow("drift");
  expect(() => sourceProjection(lineage, (p) => read(p) + "\n// drift")).toThrow("drift");
  const unapproved = structuredClone(lineage); unapproved.files[0]!.path = "unknown.ts";
  expect(() => sourceProjection(unapproved, read)).toThrow("drift");
});
