import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { shippingRoot, visibleSurfaces, newInventoryEntry, validateShipping, shippingSummary, type ShippingEntry } from "./reality/shipping-inventory";
const baseline = JSON.parse(execFileSync("git", ["show", "5fd8ee25ac54fbc4d60d74ae3c35aa45c4e476a6:docs/reality/shipping-reality.json"], { cwd: shippingRoot, encoding: "utf8", maxBuffer: 4194304 })).entries as ShippingEntry[];
if (baseline.length !== 474) throw Error("Unexpected accepted M2L baseline");
const accepted = new Map(baseline.map((entry) => [entry.id, entry]));
const path = "docs/reality/m2m-preview-proof.json", proof = existsSync(resolve(shippingRoot, path)) ? JSON.parse(readFileSync(resolve(shippingRoot, path), "utf8")) : null;
const proved = proof?.success === true && proof?.browser?.executed === true;
if (proved) {
  const checked = Bun.spawnSync([process.execPath, "--no-env-file", "scripts/verify-model2-lesson-proof.ts", path], { cwd: shippingRoot, stdout: "pipe", stderr: "pipe" });
  if (checked.exitCode !== 0) throw Error(checked.stderr.toString() || "Current lesson proof reconstruction refused");
}
const actions = new Set(["Button-03ad7717d37eb07c8c88", "Button-81c8adf0b5d574b3ca55", "Button-c2c48a9935150c9efaca", "form-b8de9e678e5fef5af1ea", "Button-3fc2b6a24341d2179f03", "Button-9a579eb19db2c73ca5e5", "input-09f0a5f8a559a03edd6c"]);
const inputs = new Set(["LessonReview-45eb64b9fdd926867cd0", "Select-5cf3d8a1686e5ad50a28", "Select-94449c6749f709ea4380", "option-507ce379458462c0af55", "option-9629eeef61c351c5240c", "option-97530eb60804ae492d80"]);
const outputs = new Set(["LessonHistory-73c268cacfded7e9e37d", "LessonResult-0fb66cc5a4f022a13e40"]);
const entries = visibleSurfaces().map((surface): ShippingEntry => {
  if (accepted.has(surface.id)) return accepted.get(surface.id)!;
  if (!/apps\/web\/src\/features\/(internalLessons|internalModel2)\//.test(surface.source)) throw Error(`Unreviewed unrelated surface: ${surface.id}`);
  if (!actions.has(surface.identity) && !inputs.has(surface.identity) && !outputs.has(surface.identity)) throw Error(`Unreviewed lesson control fingerprint: ${surface.id}`);
  const entry = newInventoryEntry(surface), technical = !actions.has(surface.identity), output = outputs.has(surface.identity);
  entry.category = technical ? output ? "INFRA_OUTPUT" : "INFRA_INPUT" : "PRODUCT_UI_ACTION";
  entry.categoryReason = technical ? output ? "Renders actual retained command results, incomplete prefixes and explicit Unknown" : "Chooses owned design/revision or authored read phase; reviewed numeric contract remains a technical input" : "Guided internal review, consent, history, explicit separate design creation and exact-retry interaction";
  entry.model1Meaning = "Internal lesson only; normal Model-1 behavior unchanged"; entry.model2Owner = "apps/backend/internalModel2/lessonExecution.ts";
  entry.resources = ["Virtual Machine", "Object Storage"]; entry.changesState = !output;
  entry.effects = { physics: technical && !output, reachability: technical && !output, security: false, cost: false, evidence: true };
  entry.provenanceRequirements = ["Versioned educational profile, exact owned design revision, immutable reviewed image/policy and actual retained capture", "No physical/provider throughput, durability, latency, security or pricing claim; missing evidence Unknown"];
  entry.status = technical ? "PARTIAL" : "NOT_APPLICABLE"; entry.finalProductEligible = !technical && proved;
  entry.ui = technical ? { status: "NOT_APPLICABLE", behavior: "Technical software proof is limited to the internal lesson; general Model-2 shipping remains closed", proofs: [] } : { status: proved ? "VALID" : "REVIEW_REQUIRED", behavior: proved ? "Real Chromium proves create/select/review/consent/exact retry after lost response and refresh, worker result, replay and mobile width" : "Await the complete real browser producer and semantic review", proofs: proved ? [path, "apps/backend/tests/integration/lessonBrowserChecks.ts", "docs/reality/m2m-handoff.md"] : [] };
  entry.plan = "Keep INTERNAL. Claude may replace presentation while preserving authenticated scoped APIs, review/retry identity, prefixes, Unknown and worker limits. General technical shipping requires separate approval and evidence.";
  return entry;
});
for (const entry of baseline) if (!entries.some((v) => v.id === entry.id)) throw Error(`Accepted surface removed: ${entry.id}`);
const errors = validateShipping(entries); if (errors.length) throw Error(errors.join("\n"));
if (process.argv.includes("--write")) writeFileSync(resolve(shippingRoot, "docs/reality/shipping-reality.json"), JSON.stringify({ schema: "infraforge-shipping-reality/2", scope: "Accepted 474 M2L entries preserved. Guided lesson additions separately reviewed; Model-2 technical shipping remains closed.", entries }, null, 2) + "\n");
console.info(JSON.stringify({ acceptedUnchanged: baseline.length, proved, ...shippingSummary(entries) }));
