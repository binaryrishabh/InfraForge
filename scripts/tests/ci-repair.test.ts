import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { analyticsBaseline, reviewAnalyticsLock } from "../review-analytics-lock";
import { contentHash, executionSource } from "../../apps/backend/internalModel2/identity";
import { readEnvelope } from "../../apps/backend/internalModel2/envelope";
import { compatibleReviewedSource, compatibleV1Source, legacyLineage } from "../../apps/backend/internalModel2/legacyCompatibility";
import { verifyConnectedProof } from "../verify-connected-proof";
const { requireFullValidation } = require("../ci/validation.cjs");
test("full validation fails closed for every red, skipped, cancelled or missing dependency", () => {
  const green = Object.fromEntries(["checks", "integration", "m2m-preview", "packaging", "operations"].map(j => [j, { result: "success" }]));
  expect(() => requireFullValidation(green)).not.toThrow();
  for (const job of Object.keys(green)) {
    for (const result of ["failure", "skipped", "cancelled", "in_progress", undefined]) expect(() => requireFullValidation({ ...green, [job]: { result } })).toThrow();
    const missing = { ...green }; delete missing[job]; expect(() => requireFullValidation(missing)).toThrow();
  }
  const workflow = readFileSync(".github/workflows/validate.yml", "utf8");
  const config = Bun.YAML.parse(workflow) as any;
  expect(Object.keys(config.jobs).sort()).toEqual(["validation", ...Object.keys(green)].sort());
  expect(config.jobs.validation.if).toBe("always()");
  expect(config.jobs.validation.needs.slice().sort()).toEqual(Object.keys(green).sort());
  expect(config.jobs.validation.steps[1].run).toBe("node scripts/ci/validation.cjs");
  expect(config.jobs.validation.steps[1].env.VALIDATION_RESULTS).toBe("${{ toJSON(needs) }}");
  const protection = JSON.parse(readFileSync("scripts/ci/main-protection.json", "utf8"));
  expect(protection.enforce_admins).toBe(true);
  expect(protection.required_status_checks.strict).toBe(true);
  const contexts = protection.required_status_checks.checks;
  expect(contexts).toHaveLength(13);
  expect(contexts.every((c: any) => c.app_id === 15368)).toBe(true);
  expect(contexts.map((c: any) => c.context).sort()).toEqual(["Full validation", ...Object.keys(green).filter(j => j !== "checks"), ...config.jobs.checks.strategy.matrix.command.map((c: string) => `checks (${c})`)].sort());
  for (const job of Object.keys(green)) expect(config.jobs[job].if).toBeUndefined();
});
test("Analytics review proves the entire prior lock is unchanged and rejects transitive/workspace drift", () => {
  const before = legacyLineage().reviewedExecution!.original.find(p => p.path === "bun.lock")!.text!;
  const after = readFileSync("bun.lock", "utf8");
  expect(analyticsBaseline).toHaveLength(40);
  expect(reviewAnalyticsLock(before, after).unchangedPackageRecords).toBeGreaterThan(400);
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
test("review refuses changed current pins, historical bytes, runtime and unreviewed source aliases", () => {
  const line = legacyLineage(), source = "c978627d82007fc5e55f4bc653ea9132b3f185e381ac0d048afda1645d319ca6";
  const before = structuredClone(line);
  const mutations = [
    () => { line.current.find(p => p.path === "bun.lock")!.hash = "0".repeat(64); },
    () => { line.current = line.current.filter(p => p.path !== "apps/backend/internalModel2/envelopeV2.ts"); },
    () => { line.reviewedExecution!.original.find(p => p.path === "bun.lock")!.hash = "0".repeat(64); },
    () => { line.reviewedExecution!.original.find(p => p.path.endsWith("/legacyRuntime.json"))!.text += " "; },
    () => { line.reviewedExecution!.source = "0".repeat(64); },
    () => { line.runtime = "bun-unreviewed"; },
    () => { line.reviewedExecution!.context.find(p => p.path === "bunfig.toml")!.hash = "0".repeat(64); },
    () => { line.reviewedExecution!.inventory.pop(); },
  ];
  for (const mutate of mutations) {
    try { mutate(); expect(compatibleReviewedSource(source, executionSource)).toBe(false); }
    finally { Object.assign(line, structuredClone(before)); }
  }
  expect(compatibleReviewedSource(source, executionSource)).toBe(true);
});
