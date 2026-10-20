import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { digest, sourceHash } from "../../apps/backend/executionIdentity/hash";
import { firstStackClaims, firstStackScopeExamples, firstStackFieldDisposition } from "../../packages/contracts/src/first-stack";
import { exposedFields, readManifest } from "../reality/launch-contract";
import { verifyFirstStackCompileProof } from "../reality/first-stack-compile-proof";

test("first stack freezes the merged Stage 1 descriptor and eight historical fixtures", () => {
  const baseline = JSON.parse(readFileSync("docs/reality/first-stack-baseline.json", "utf8"));
  expect(baseline.commit).toBe("bd5777e2157339f1a583fb4986843be8a046f0d2");
  expect(digest(baseline.descriptor)).toBe(baseline.source);
  expect(baseline.compositions).toEqual(JSON.parse(readFileSync("docs/reality/stage1-composition-hashes.json", "utf8")));
  expect(baseline.compositions).toHaveLength(8);
});
test("first stack has explicit scope examples, no calibrated timing and no activation", () => {
  expect(firstStackScopeExamples).toHaveLength(6);
  expect(firstStackScopeExamples.map(s => s.apps)).toEqual([1, 1, 2, 2, 8, 8]);
  expect(firstStackClaims).toMatchObject({ timing: "assumption-only", fullCost: "Unknown", activeEngine: "1", execution: "unavailable" });
  expect(readManifest().claims.filter(c => c.id.startsWith("FirstStack")).every(c => c.model2 !== "supported-calibrated")).toBe(true);
});
test("every legacy resource and edge field has an authoring disposition", () => {
  for (const field of exposedFields().filter(f => /^(Resource|ConnectionLine)\.[^.]+$/.test(f.key))) {
    expect(Object.hasOwn(firstStackFieldDisposition, field.key.split(".")[1]!)).toBe(true);
  }
});
test("first stack source review binds new behavior and its acceptance tests independently", () => {
  const lock = JSON.parse(readFileSync("docs/reality/first-stack-source-review.json", "utf8"));
  const baseline = JSON.parse(readFileSync("docs/reality/first-stack-baseline.json", "utf8"));
  expect(lock.schema).toBe("infraforge-first-stack-source-review/1");
  expect(lock.baseline).toBe(baseline.source);
  expect(lock.files).toHaveLength(31);
  expect(lock.acceptance).toHaveLength(13);
  for (const { path, hash } of [...lock.files, ...lock.acceptance]) expect(sourceHash(readFileSync(path, "utf8"))).toBe(hash);
});

test("first stack V2 retained proof reproduces independently of its observers", async () => {
  expect(await verifyFirstStackCompileProof()).toEqual({ cases: 4, reconstructedOriginalHostFiles: 88, observerEqual: true, repeatBytesEqual: true });
});
