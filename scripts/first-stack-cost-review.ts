import { readFileSync, writeFileSync } from "node:fs";
import { sourceHash } from "../apps/backend/executionIdentity/hash";
import { exposedFields } from "./reality/launch-contract";

// Review the bounded offline cost projection separately from execution identity.
// This producer adds no transitions or permissions to execute provider workloads.
if (!process.argv.includes("--write")) throw Error("Use --write after reviewing the frozen cost data adapter");
const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const files = ["apps/backend/firstStack/providerCost.ts", "apps/backend/firstStack/report.ts", "apps/backend/firstStack/reportCapture.ts",
  "apps/backend/firstStack/executionCut.ts", "packages/simulation/src/internalFirstStack.ts", "packages/contracts/src/reports/firstStack.ts"];
const acceptance = ["scripts/tests/first-stack-cost.test.ts"];
const reviewPath = "apps/backend/executionIdentity/capabilityReviews.json", reviews = JSON.parse(read(reviewPath));
for (const path of files.filter(p => p.startsWith("apps/backend/"))) {
  const old = reviews[path];
  reviews[path] = { ...old, hash: sourceHash(read(path)), capabilities: [...new Set([...(old?.capabilities ?? []), "computed-data"])],
    review: "Bounded offline first-stack frozen tariff and explicit host allocation lifecycle projection; exact existing EC2 arithmetic, no process/clock/network access, compiler/provider inference or activation" };
}
writeFileSync(reviewPath, JSON.stringify(reviews, null, 2) + "\n");
// Refresh only changed pins in prior source reviews, retaining their original
// scopes, acceptance counts and all unrelated historical pins.
for (const path of ["docs/reality/first-stack-source-review.json", "docs/reality/first-stack-isolation-source-review.json",
  "docs/reality/first-stack-submission-source-review.json", "docs/reality/first-stack-report-source-review.json",
  "docs/reality/finite-io-source-review.json", "docs/reality/postgres-session-source-review.json"]) {
  const review = JSON.parse(read(path));
  for (const row of [...review.files, ...(review.acceptance ?? [])]) if (files.includes(row.path)) row["sha256" in row ? "sha256" : "hash"] = sourceHash(read(row.path));
  writeFileSync(path, JSON.stringify(review, null, 2) + "\n");
}
const manifestPath = "docs/reality/launch-claims.json", manifest = JSON.parse(read(manifestPath));
const fields = exposedFields().filter(f => f.file === "packages/contracts/src/reports/firstStack.ts" &&
  /^(FirstStackComputeCost\.|FirstStackCostComparison\.|FirstStackReport\.cost$|FirstStackReportCapture\.computeCost$)/.test(f.key)).map(f => f.key);
const claim = { id: "FirstStackComputeCost", fields, mechanism: "Frozen exact scoped EC2 tariff multiplied by complete explicit modeled host allocation sessions; shared roles charged once; labelled supported compute subtotal",
  model1: "unsupported", model2: "supported-logical",
  scope: "Conditional covered-meter arithmetic only. Missing/unsupported/expired quotes, missing/duplicate allocation usage and mixed currency are Unknown. Full cost remains Unknown with explicit exclusions. No monthly extrapolation, cloud calibration or Model 2 activation.",
  sources: [{ file: "apps/backend/firstStack/providerCost.ts", anchor: "export function firstStackComputeCost" }] };
const index = manifest.claims.findIndex((c: { id: string }) => c.id === claim.id);
if (index < 0) manifest.claims.push(claim); else manifest.claims[index] = claim;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync("docs/reality/first-stack-cost-source-review.json", JSON.stringify({ schema: "first-stack-cost-source-review/1",
  scope: "Data/logic only; explicit offline selection and allocation boundary evidence; no automatic usage or provider inference; Model 2 inactive",
  files: files.map(path => ({ path, hash: sourceHash(read(path)) })), acceptance: acceptance.map(path => ({ path, hash: sourceHash(read(path)) })),
}, null, 2) + "\n");
