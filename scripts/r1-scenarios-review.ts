import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { sourceHash } from "../apps/backend/executionIdentity/hash";

// Additive exact-source review for the six R1 data versions. The original
// scored framework review remains unchanged, including its historical checks.
if (!process.argv.includes("--write")) throw Error("Use --write after reviewing R1 data and capacity qualification");
const baseline = "fd8253b26850b870465f15632cd82ea96eb441a7";
execFileSync("git", ["merge-base", "--is-ancestor", baseline, "main"]);
const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const original = (path: string) => execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).replaceAll("\r\n", "\n");
const ids = ["url-redirect", "catalogue-api", "reviews-api", "small-paste-api", "preloaded-news-api", "price-history-api"];
const folder = "apps/backend/firstStack/scoredChallenges/", definition = folder + "definition.ts";
const files = ids.map(id => folder + id + ".v1.json");
const transitionTest = "scripts/tests/execution-identity.test.ts";
const expectedTransition = original(transitionTest).replace("expect(table.entries.length).toBe(55);",
  `expect(table.entries.length).toBe(56);\n  expect(table.entries.some((row: { commit: string }) => row.commit === "${baseline}")).toBe(true);`);
if (read(transitionTest) !== expectedTransition) throw Error("Only the additional retained-main transition assertion is reviewed");
if (read(".dockerignore") !== original(".dockerignore") + files.map(path => `!${path}\n`).join("")) throw Error("Only six exact R1 data files may enter the image context");
// The only runtime code delta is static registration and exact ID/version lookup.
const names = ["redirect", "catalogue", "reviews", "paste", "news", "history"];
let expected = original(definition).replace('import source from "./lose-an-app-server.v1.json";',
  'import source from "./lose-an-app-server.v1.json";\n' + ids.map((id, i) => `import ${names[i]} from "./${id}.v1.json";`).join("\n"));
expected = expected.replace("export function challengeDefinition(id: string, version: string): ChallengeDefinition {", `const definitions = [source, ${names.join(", ")}];\nexport function challengeDefinition(id: string, version: string): ChallengeDefinition {`)
  .replace('  if (id !== source.id || version !== source.version) throw new ValidationError("Scored challenge version unavailable");\n  return challengeDefinitionSchema.parse(source) as unknown as ChallengeDefinition;',
    '  const selected = definitions.find(d => d.id === id && d.version === version);\n  if (!selected) throw new ValidationError("Scored challenge version unavailable");\n  return challengeDefinitionSchema.parse(selected) as unknown as ChallengeDefinition;');
if (read(definition) !== expected) throw Error("Outside reviewed static registry delta");
for (const path of ["execution.ts", "projection.ts", "scoring.ts", "lose-an-app-server.v1.json"].map(name => folder + name).concat([
  "apps/backend/firstStack/admission.ts", "apps/backend/firstStack/submissionRoutes.ts", "apps/backend/firstStack/submissionWorker.ts",
  "apps/backend/executionIdentity/descriptor.ts", "apps/backend/firstStack/isolationRunner.ts", "apps/backend/prisma/schema.prisma",
  "scripts/frozen-baseline.ts", "scripts/scored-challenges-review.ts",
])) if (read(path) !== original(path)) throw Error(`Outside R1 data review: ${path}`);
const reviewPath = "apps/backend/executionIdentity/capabilityReviews.json", reviews = JSON.parse(read(reviewPath));
const hash = sourceHash(read(definition));
reviews[definition] = { ...reviews[definition], hash,
  review: "Exact R1 static registry review: six server-only finite API JSON versions and exact ID/version selection; existing strict validation, capacity-only admission and public projection unchanged; no host, engine, scoring or activation changes",
  globals: { hash, names: ["TextEncoder"] } };
writeFileSync(reviewPath, JSON.stringify(reviews, null, 2) + "\n");
const acceptance = ["apps/backend/tests/r1Scenarios.test.ts", "scripts/tests/boundaries.test.ts", transitionTest];
// Refresh only this review's changed source/acceptance entries in prior manifests.
for (const path of ["docs/reality/first-stack-source-review.json", "docs/reality/first-stack-isolation-source-review.json",
  "docs/reality/first-stack-submission-source-review.json", "docs/reality/first-stack-report-source-review.json",
  "docs/reality/finite-io-source-review.json", "docs/reality/postgres-session-source-review.json", "docs/reality/scored-challenges-source-review.json"]) {
  const review = JSON.parse(read(path));
  for (const row of [...review.files, ...(review.acceptance ?? [])]) {
    if ([definition, ".dockerignore", ...acceptance].includes(row.path)) row["sha256" in row ? "sha256" : "hash"] = sourceHash(read(row.path));
  }
  if (path.endsWith("/scored-challenges-source-review.json")) {
    for (const path of files) if (!review.files.some((row: { path: string }) => row.path === path)) review.files.push({ path, hash: sourceHash(read(path)) });
    if (!review.acceptance.some((row: { path: string }) => row.path === acceptance[0])) review.acceptance.push({ path: acceptance[0], hash: sourceHash(read(acceptance[0]!)) });
    review.r1 = { baseline, scope: "Six cache-free finite R1 API data versions; synthetic qualification; timing assumption-only; cost Unknown" };
  }
  writeFileSync(path, JSON.stringify(review, null, 2) + "\n");
}
