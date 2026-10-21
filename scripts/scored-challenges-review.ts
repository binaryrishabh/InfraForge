import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { sourceHash } from "../apps/backend/executionIdentity/hash";

// Exact-source review before the final identity refresh. No host declaration,
// process permission, historical algorithm or activation policy changes.
if (!process.argv.includes("--write")) throw Error("Use --write after reviewing the scored challenge data and executor boundary");
const baseline = "abf2d142a64a6b5e5f3515efeb98e7d6ae036ca8";
execFileSync("git", ["merge-base", "--is-ancestor", baseline, "main"]);
const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const original = (path: string) => execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).replaceAll("\r\n", "\n");
const transitionTest = "scripts/tests/execution-identity.test.ts";
const expected = original(transitionTest).replace("expect(table.entries.length).toBe(51);",
  `expect(table.entries.length).toBe(52);\n  expect(table.entries.some((row: { commit: string }) => row.commit === "${baseline}")).toBe(true);`);
if (read(transitionTest) !== expected) throw Error("Only the additional retained-main transition assertion is reviewed");
const loading = "apps/backend/executionIdentity/loading.ts";
const stripPin = (text: string) => text.replace(/const analysisPin = "[a-f0-9]{64}";/, 'const analysisPin = "generated";');
if (stripPin(read(loading)) !== stripPin(original(loading))) throw Error("Loading policy changes require separate review; only a generated analysis pin may differ");
const docker = ".dockerignore", beforeDocker = original(docker);
const expectedDocker = beforeDocker.replace("!apps/backend/firstStack/*.ts\n", "!apps/backend/firstStack/*.ts\n" +
  "!apps/backend/firstStack/scoredChallenges/\napps/backend/firstStack/scoredChallenges/**\n" +
  "!apps/backend/firstStack/scoredChallenges/*.ts\n!apps/backend/firstStack/scoredChallenges/lose-an-app-server.v1.json\n");
if (expectedDocker === beforeDocker || read(docker) !== expectedDocker) throw Error("Only the scored server modules and exact authored JSON are added to the image context");
for (const path of ["apps/backend/executionIdentity/descriptor.ts", "scripts/historical-declared-host-descriptor.ts",
  "scripts/frozen-baseline.ts", "scripts/execution-identity.ts", "scripts/tests/futureBaseline.test.ts",
  "apps/backend/firstStack/isolationRunner.ts", "apps/backend/firstStack/isolationOwnership.ts", "apps/backend/firstStack/isolationConnection.ts",
  "apps/backend/prisma/schema.prisma", "apps/backend/index.ts", "apps/backend/worker.ts"]) {
  if (read(path) !== original(path)) throw Error(`Outside scored challenge review: ${path}`);
}
const modules = ["definition", "execution", "projection", "scoring"].map(name => `apps/backend/firstStack/scoredChallenges/${name}.ts`);
const changed = ["apps/backend/firstStack/admission.ts", "apps/backend/firstStack/submissionRoutes.ts", "apps/backend/firstStack/submissionWorker.ts"];
const files = [...changed, ...modules, "apps/backend/firstStack/scoredChallenges/lose-an-app-server.v1.json", "scripts/boundaries.ts", docker];
const acceptance = ["apps/backend/tests/scoredChallenges.test.ts", "apps/backend/tests/integration/firstStackSubmission.integration.test.ts", "scripts/tests/boundaries.test.ts", transitionTest];
const reviewPath = "apps/backend/executionIdentity/capabilityReviews.json", reviews = JSON.parse(read(reviewPath));
for (const path of [...changed, ...modules]) {
  const hash = sourceHash(read(path));
  reviews[path] = { ...reviews[path], hash, capabilities: [...new Set([...(reviews[path]?.capabilities ?? []), "computed-data"])],
    review: "Exact scored challenge review: strict server-owned JSON and capacity constraints; fixed bounded data projection and grading; same serial isolated executor/session fence; append-only score result; no evaluator, host activation, new process adapter, engine physics or Model 1 rubric constants",
    ...(path.endsWith("/definition.ts") ? { globals: { hash, names: ["TextEncoder"] } } : {}) };
}
writeFileSync(reviewPath, JSON.stringify(reviews, null, 2) + "\n");
// Preserve unrelated historical review pins; update only reviewed source and
// acceptance that those reviews explicitly address.
for (const path of ["docs/reality/first-stack-source-review.json", "docs/reality/first-stack-isolation-source-review.json",
  "docs/reality/first-stack-submission-source-review.json", "docs/reality/first-stack-report-source-review.json",
  "docs/reality/finite-io-source-review.json", "docs/reality/postgres-session-source-review.json"]) {
  const review = JSON.parse(read(path));
  for (const row of [...review.files, ...(review.acceptance ?? [])]) {
    if ([...files, ...acceptance].includes(row.path)) row["sha256" in row ? "sha256" : "hash"] = sourceHash(read(row.path));
  }
  writeFileSync(path, JSON.stringify(review, null, 2) + "\n");
}
writeFileSync("docs/reality/scored-challenges-source-review.json", JSON.stringify({ schema: "scored-challenges-source-review/1", baseline,
  scope: "Server-only versioned hidden workload grading; existing isolated serial executor and immutable result guards; Model 2 inactive; timing assumption-only; cost Unknown",
  files: files.map(path => ({ path, hash: sourceHash(read(path)) })), acceptance: acceptance.map(path => ({ path, hash: sourceHash(read(path)) })),
}, null, 2) + "\n");
