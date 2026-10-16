import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { shippingRoot, shippingInventory, visibleSurfaces, validateShipping, shippingSummary, newInventoryEntry, type ShippingEntry } from "./reality/shipping-inventory";

// An additive review: never reclassify an accepted surface through this script.
const baselineSha = "c246adffd166c5b422e273eda81f0f624f67e032";
const baseline = JSON.parse(execFileSync("git", ["show", `${baselineSha}:docs/reality/shipping-reality.json`], { cwd: shippingRoot, encoding: "utf8", maxBuffer: 4194304 })).entries as ShippingEntry[];
if (baseline.length !== 441) throw Error("Unexpected accepted inventory baseline");
const accepted = new Map(baseline.map((entry) => [entry.id, entry]));
const current = new Map(shippingInventory().entries.map((entry) => [entry.id, entry]));
const proofPath = "docs/reality/m2l-browser-proof.json";
const checked = Bun.spawnSync([process.execPath, "--no-env-file", "scripts/verify-model2-workspace-proof.ts", proofPath], { cwd: shippingRoot, stdout: "pipe", stderr: "pipe" });
if (checked.exitCode !== 0) throw Error(checked.stderr.toString() || "Browser proof reconstruction refused");
const proof = JSON.parse(readFileSync(resolve(shippingRoot, proofPath), "utf8"));
if (!proof.success || proof.schema !== "infraforge-m2l-browser/1" || !proof.cases.includes("review editing and saved/history refresh")) throw Error("Retain and verify the complete real M2L browser producer before reviewing inventory");
const proofs = [proofPath, "apps/backend/tests/integration/model2BrowserChecks.ts", "apps/backend/tests/model2Authoring.test.ts", "apps/web/tests/internalModel2.test.tsx", "docs/reality/m2l-workspace-handoff.md"];
const ui = new Set([
  "Button-0483e8afa542614e2456", "Button-83cd85fb1a40e732668b", "Button-9bf1d0ef820eb57efc92",
  "Button-822aaef14cea6e5b17b9", "Button-99e819acc2d4d7cf32b6", "Button-d405dda6a87356586f44", "form-6ebe16f1dd0930d47929",
  "Button-41fcabf9a6a505660607", "Button-ba304f3baca040c5f6e0", "input-09f0a5f8a559a03edd6c",
]);
const entries = visibleSurfaces().map((surface): ShippingEntry => {
  const previous = accepted.get(surface.id);
  if (previous) {
    if (JSON.stringify(current.get(surface.id)) !== JSON.stringify(previous)) throw Error(`Accepted entry changed: ${surface.id}`);
    return previous;
  }
  if (!surface.source.startsWith("apps/web/src/features/internalModel2/")) throw Error(`Unreviewed unrelated addition: ${surface.id}`);
  const entry = newInventoryEntry(surface), action = ui.has(surface.identity), output = surface.identity.startsWith("Value-");
  const fault = /draft\.crash|Input-f7dbd3dc935088e02abb/.test(surface.description + surface.identity);
  const security = /draft\.security|plaintext-reviewed/.test(surface.description);
  entry.category = action ? "PRODUCT_UI_ACTION" : output ? "INFRA_OUTPUT" : fault ? "FAULT_CONTROL" : security ? "SECURITY_CONTROL" : "INFRA_INPUT";
  entry.categoryReason = action ? "Authoring/review/report navigation and run lifecycle action; technical input controls and evidence remain separately inventoried" : output ? "Renders actual retained Model-2 modeled facts, usage and state; no physical/cloud guarantee" : "Authored technical input to the narrow M2K compiler; includes explicit units, limits and educational origin rather than provider defaults";
  entry.resources = ["Virtual Machine", "Object Storage"];
  entry.model1Meaning = "Dedicated granted internal workspace; existing Model-1 runs unchanged";
  entry.model2Owner = output ? "apps/backend/internalModel2/report.ts" : action ? surface.source : "apps/backend/internalModel2/authoring.ts";
  entry.changesState = !action && !output;
  entry.effects = { physics: !action && !output && !security, reachability: !action && !output, security, cost: false, evidence: true };
  entry.provenanceRequirements = ["Explicit owner-authored educational origin and units; exact saved revision, immutable envelope and retained capture identity", "Physical throughput/cloud timing/reliability/durability and full pricing Unknown; explicit server grant and owner checks on every request"];
  entry.ui = action ? { status: "VALID", behavior: "Actual Chromium exercised validation, review/back/consent, exact retry after lost response/refresh/duplicate click, saved/history/report refresh, cancellation and compatible replay; responsive and authorization refusal paths retained", proofs } : { status: "NOT_APPLICABLE", behavior: "Technical readiness is separate from interaction behavior; guided compilation/runtime and browser proof cover only the internal authored scope", proofs };
  entry.status = action ? "NOT_APPLICABLE" : "PARTIAL";
  entry.finalProductEligible = action;
  entry.plan = action ? "Preserve API/auth/retry/accessibility semantics during Claude redesign; reprove replacement control fingerprints" : "Keep INTERNAL. Broader physical, provider, resource and reliability support needs independent contracts/proofs before general Model-2 shipping";
  return { ...entry, ...surface };
});
for (const id of accepted.keys()) if (!entries.some((entry) => entry.id === id)) throw Error(`Accepted surface removed: ${id}`);
const errors = validateShipping(entries);
if (errors.length) throw Error(errors.join("\n"));
if (process.argv.includes("--write")) writeFileSync(resolve(shippingRoot, "docs/reality/shipping-reality.json"), JSON.stringify({ schema: "infraforge-shipping-reality/2", scope: "Separate PRODUCT_UI_VALIDITY from MODEL2_REALITY_SHIPPING_READY. M2L additions have narrow internal browser/API/worker proof; accepted 441-entry baseline preserved.", entries }, null, 2) + "\n");
console.info(JSON.stringify({ acceptedUnchanged: baseline.length, producer: proof.commit, ...shippingSummary(entries) }));
