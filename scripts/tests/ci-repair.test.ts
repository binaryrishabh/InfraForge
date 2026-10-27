import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { analyticsBaseline, reviewAnalyticsLock, reviewAnalyticsManifest } from "../review-analytics-lock";
import { contentHash, executionSource, hasher } from "../../apps/backend/internalModel2/identity";
import { readEnvelope } from "../../apps/backend/internalModel2/envelope";
import { compatibleReviewedSource, compatibleV1Source, legacyLineage } from "../../apps/backend/internalModel2/legacyCompatibility";
import { verifyConnectedProof } from "../verify-connected-proof";
import { frozenHistoryText, lastCommit } from "../execution-identity";
const { requireFullValidation } = require("../ci/validation.cjs");
test("validation requires every job to succeed on every main push", () => {
  const jobs = ["identity", "checks", "integration", "m2m-preview", "packaging", "operations"];
  const green = Object.fromEntries(jobs.map(job => [job, { result: "success" }]));
  expect(() => requireFullValidation(green)).not.toThrow();
  for (const job of jobs) {
    for (const result of ["failure", "cancelled", "in_progress", undefined, "skipped"]) {
      expect(() => requireFullValidation({ ...green, [job]: { result } })).toThrow();
    }
    const missing = { ...green }; delete missing[job];
    expect(() => requireFullValidation(missing)).toThrow();
  }
  expect(() => requireFullValidation({ ...green, unexpected: { result: "success" } })).toThrow();
  const config = Bun.YAML.parse(readFileSync(".github/workflows/validate.yml", "utf8")) as any;
  expect(config.on.push.branches).toEqual(["main"]);
  expect(config.on.push.paths).toBeUndefined();
  expect(config.on.push["paths-ignore"]).toBeUndefined();
  expect(Object.keys(config.jobs).sort()).toEqual(["validation", ...jobs].sort());
  expect(config.jobs.validation.if).toBe("always()");
  expect(config.jobs.validation.needs.slice().sort()).toEqual(jobs.slice().sort());
  expect(config.jobs.validation.steps[1].run).toBe("node scripts/ci/validation.cjs");
  expect(config.jobs.validation.steps[1].env.VALIDATION_RESULTS).toBe("${{ toJSON(needs) }}");
  expect(config.jobs.identity.steps.map((step: any) => step.run)).toContain("bun --no-env-file scripts/execution-identity.ts --check");
  expect(config.jobs.identity.steps.map((step: any) => step.run)).toContain("bun --no-env-file scripts/execution-resolution.ts");
  for (const job of jobs) {
    if (job !== "identity") expect(config.jobs[job].needs).toBe("identity");
    expect(config.jobs[job].if).toBeUndefined();
    expect(config.jobs[job].steps.every((step: any) => !String(step.if).includes("docs_only"))).toBe(true);
  }
});

test("Analytics review proves the entire prior lock is unchanged and rejects transitive/workspace drift", () => {
  const before = legacyLineage().reviewedExecution!.original.find(p => p.path === "bun.lock")!.text!;
  const after = frozenHistoryText(lastCommit, "bun.lock");
  expect(analyticsBaseline).toHaveLength(40);
  expect(reviewAnalyticsLock(before, after).unchangedPackageRecords).toBeGreaterThan(400);
  expect(() => reviewAnalyticsManifest(frozenHistoryText(analyticsBaseline, "apps/web/package.json"), frozenHistoryText(lastCommit, "apps/web/package.json"))).not.toThrow();
  for (const changed of [after.replace('"zod@4.4.3"', '"zod@4.4.4"'), after.replace('"bullmq": "6.0.8"', '"bullmq": "6.0.9"'), after.replace('"optionalPeers": ["@remix-run/react"', '"dependencies": {"new-code":"1"}, "optionalPeers": ["@remix-run/react"')]) {
    expect(() => reviewAnalyticsLock(before, changed)).toThrow();
  }
});
test("reviewed sources reconstruct historical execution without rewriting accepted connected evidence", () => {
  expect(compatibleReviewedSource("c978627d82007fc5e55f4bc653ea9132b3f185e381ac0d048afda1645d319ca6", executionSource)).toBe(true);
  expect(compatibleV1Source("bac35c995b5e5d59a9ce901745c014644fdb843183adbcbb761fb99184c11306", executionSource)).toBe(true);
  expect(compatibleReviewedSource("0".repeat(64), executionSource)).toBe(false);
  const proof = JSON.parse(readFileSync("docs/reality/connected-web-proof.json", "utf8"));
  const before = JSON.stringify(proof);
  expect(verifyConnectedProof(proof).verified).toBe(true);
  expect(JSON.stringify(proof)).toBe(before);
  for (const change of [{ source: "0".repeat(64) }, { compiledHash: "0".repeat(64) }]) {
    const { fingerprint: _old, ...body } = { ...proof.runs[0].row.input, ...change };
    const fingerprint = contentHash(body);
    expect(() => readEnvelope({ ...body, fingerprint }, fingerprint)).toThrow();
  }
}, 60000);
test("the frozen Analytics review retains its pins, historical bytes, runtime and inventory", () => {
  const line = legacyLineage();
  const frozen = JSON.parse(frozenHistoryText(lastCommit, "apps/backend/internalModel2/legacyRuntime.json"));
  // Current-source review moves forward; the frozen scientific lineage does not.
  expect(line.reviewedExecution).toEqual(frozen.reviewedExecution);
  expect(line.execution).toEqual(frozen.execution);
  expect(line.original.map(({ path, hash }) => ({ path, hash }))).toEqual(frozen.original.map(({ path, hash }: { path: string; hash: string }) => ({ path, hash })));
  for (const pin of line.current) expect(hasher.hash(readFileSync(pin.path, "utf8").replaceAll("\r\n", "\n"))).toBe(pin.hash);
  expect(line.runtime).toBe("bun-1.3.14");
  const review = line.reviewedExecution!;
  expect(review.inventory).toEqual(review.original.map(pin => pin.path));
  for (const pin of review.context) expect(hasher.hash(frozenHistoryText(lastCommit, pin.path))).toBe(pin.hash);
  const files = review.original.map(pin => {
    const text = pin.text ?? frozenHistoryText(lastCommit, pin.path);
    expect(hasher.hash(text)).toBe(pin.hash);
    return [pin.path, text];
  });
  expect(contentHash({ runtime: line.runtime, files })).toBe("c978627d82007fc5e55f4bc653ea9132b3f185e381ac0d048afda1645d319ca6");
}, 60000);
