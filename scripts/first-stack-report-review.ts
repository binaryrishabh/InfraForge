import { readFileSync, writeFileSync } from "node:fs";
import { sourceHash } from "../apps/backend/executionIdentity/hash";
import { exposedFields } from "./reality/launch-contract";

// Exact-source review for bounded data reduction only. This command grants no
// execution host, process adapter, activation or historical compatibility.
if (!process.argv.includes("--write")) throw Error("Use --write after reviewing the report data boundary");
const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const files = ["apps/backend/firstStack/report.ts", "apps/backend/firstStack/reportCapture.ts", "apps/backend/firstStack/admission.ts",
  "apps/backend/firstStack/executionCut.ts", "apps/backend/firstStack/isolationProtocol.ts", "apps/backend/runRecords/firstStack.ts",
  "apps/backend/runRecords/adapters.ts", "packages/simulation/src/firstStack/journal.ts", "packages/contracts/src/reports/firstStack.ts",
  "packages/contracts/src/reports/index.ts", "scripts/reality/launch-contract.ts"];
const acceptance = ["apps/backend/tests/firstStackReport.test.ts", "apps/backend/tests/integration/firstStackSubmission.integration.test.ts", "scripts/tests/first-stack-report.test.ts", "scripts/tests/first-stack-report-data.test.ts"];
const path = "apps/backend/executionIdentity/capabilityReviews.json", reviews = JSON.parse(read(path));
for (const path of files.filter(p => !p.startsWith("scripts/") && !p.startsWith("packages/contracts/"))) {
  const old = reviews[path];
  reviews[path] = { ...old, hash: sourceHash(read(path)), capabilities: [...new Set([...(old?.capabilities ?? []), "computed-data"])],
    review: "Bounded first-stack report data capture/projection: fixed schemas, finite JSON, selected journal identities, immutable input/capture verification; no evaluators, new process permissions, physics changes or activation" };
}
writeFileSync(path, JSON.stringify(reviews, null, 2) + "\n");
// Retain each historical review's scope and exact unchanged pins. Only report
// source and the affected integration acceptance receive current source pins.
const changed = new Set([...files, ...acceptance]);
for (const path of ["docs/reality/first-stack-source-review.json", "docs/reality/first-stack-isolation-source-review.json", "docs/reality/first-stack-submission-source-review.json"]) {
  const review = JSON.parse(read(path));
  for (const row of [...review.files, ...(review.acceptance ?? [])]) if (changed.has(row.path)) row["sha256" in row ? "sha256" : "hash"] = sourceHash(read(row.path));
  writeFileSync(path, JSON.stringify(review, null, 2) + "\n");
}
const manifestPath = "docs/reality/launch-claims.json", manifest = JSON.parse(read(manifestPath));
const fields = exposedFields().filter(f => f.file === "packages/contracts/src/reports/firstStack.ts").map(f => f.key);
for (const timing of [true, false]) {
  const id = timing ? "FirstStackReportTiming" : "FirstStackReportEvidence";
  const claim = { id, fields: fields.filter(f => /^(FirstStackTail\.|FirstStackReport\.latency)/.test(f) === timing),
    mechanism: timing ? "Retained terminal caller distributions, exact empirical ranks or histogram intervals with 2/20/100 computational minima" : "Immutable RunRecord projection with explicit populations, prefix completeness, bounded diagnostic selection and evidence-addressed lifecycle links",
    model1: "unsupported", model2: timing ? "assumption-only" : "supported-logical",
    scope: "Simulated observations only; browser evidence stays untrusted, missing mechanisms and omitted causal evidence stay Unknown. No Model 2 activation or cloud calibration.",
    sources: [{ file: "apps/backend/firstStack/report.ts", anchor: "export function firstStackReport" }] };
  const index = manifest.claims.findIndex((c: { id: string }) => c.id === id);
  if (index < 0) manifest.claims.push(claim); else manifest.claims[index] = claim;
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync("docs/reality/first-stack-report-source-review.json", JSON.stringify({ schema: "first-stack-report-source-review/1",
  scope: "Data/contract layer only; bounded additive report capture, read-only history and selected causal facts; Model 2 inactive",
  files: files.map(path => ({ path, hash: sourceHash(read(path)) })), acceptance: acceptance.map(path => ({ path, hash: sourceHash(read(path)) })),
}, null, 2) + "\n");
