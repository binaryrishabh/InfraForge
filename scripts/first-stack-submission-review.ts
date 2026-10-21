import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { sourceHash } from "../apps/backend/executionIdentity/hash";

// Exact source review, separate from the final generated identity refresh.
if (!process.argv.includes("--write")) throw Error("Use --write after reviewing submission/store capabilities");
const baseline = "7fdc72ef9c77bb0ad44bda3134f1899e31e6e9f1";
const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const original = (path: string) => execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).replaceAll("\r\n", "\n");
const acceptance = "scripts/tests/execution-identity.test.ts", descriptor = "apps/backend/executionIdentity/descriptor.ts";
const expectedTest = original(acceptance).replace("expect(table.entries.length).toBe(48);", `expect(table.entries.length).toBe(49);\n  expect(table.entries.some((row: { commit: string }) => row.commit === "${baseline}")).toBe(true);`);
if (read(acceptance) !== expectedTest) throw Error("Submission review permits only the added retained-main transition assertion");
const oldDescriptor = original(descriptor);
const expectedDescriptor = oldDescriptor.replace('"apps/backend/firstStack/isolationOwnership.ts"];', '"apps/backend/firstStack/isolationOwnership.ts",\n  "apps/backend/firstStack/submissionRoutes.ts", "apps/backend/firstStack/submissionQueue.ts"];');
if (read(descriptor) !== expectedDescriptor || expectedDescriptor === oldDescriptor) throw Error("Only add inactive submission entrypoints to identity closure");
const verifier = "scripts/execution-identity.ts";
const expectedVerifier = original(verifier)
  .replace('import { historicalIsolationDescriptor } from "./historical-isolation-descriptor";', 'import { historicalIsolationDescriptor } from "./historical-isolation-descriptor";\nimport { historicalDeclaredHostDescriptor } from "./historical-declared-host-descriptor";')
  .replace('row.algorithm === "isolation-boundary/1" ?', 'row.algorithm === "declared-host-boundary/1" ? historicalDeclaredHostDescriptor : row.algorithm === "isolation-boundary/1" ?');
if (read(verifier) !== expectedVerifier) throw Error("Only add the new frozen reconstruction dispatch; retain all existing checks");
for (const [path, allowed] of [["docs/reality/first-stack-source-review.json", acceptance],
  ["docs/reality/finite-io-source-review.json", acceptance], ["docs/reality/postgres-session-source-review.json", acceptance],
  ["docs/reality/first-stack-isolation-source-review.json", descriptor]]) {
  const before = JSON.parse(original(path!)), expected = structuredClone(before);
  const changed = path === "docs/reality/first-stack-isolation-source-review.json" ? [allowed,
    "apps/backend/firstStack/isolationRunner.ts", "apps/backend/firstStack/isolationOwnership.ts", verifier] : [allowed, verifier];
  for (const row of [...expected.files, ...(expected.acceptance ?? [])]) {
    if (changed.includes(row.path)) {
      const field = "sha256" in row ? "sha256" : "hash";
      row[field] = sourceHash(read(row.path));
    }
    // Some retained reviews intentionally pin an older execution body. Keep
    // those exact pins, and require every unrelated source to equal main.
    else if (read(row.path) !== original(row.path)) throw Error(`Outside submission review: ${row.path}`);
  }
  if (![before, expected].some(value => JSON.stringify(value) === JSON.stringify(JSON.parse(read(path!))))) throw Error("Unrelated prior review changes");
  writeFileSync(path!, JSON.stringify(expected, null, 2) + "\n");
}
const modules = ["admission", "submissionRoutes", "submissionWorker", "submissionQueue"].map(name => `apps/backend/firstStack/${name}.ts`);
const ownership = ["isolationRunner", "isolationOwnership"].map(name => `apps/backend/firstStack/${name}.ts`);
const reviewPath = "apps/backend/executionIdentity/capabilityReviews.json", reviews = JSON.parse(read(reviewPath));
for (const path of [...modules, "apps/backend/release/firstStackSchema.ts", "apps/backend/release/migrations.ts"]) {
  reviews[path] = { hash: sourceHash(read(path)), capabilities: ["computed-data", ...(path.startsWith("apps/backend/release/") ? ["resources"] : [])],
    review: "Exact inactive first-stack admission/store/serial queue and release schema review: bounded data, fixed SQL, owned immutable input and cut fence; trusted operator injection only; no evaluators, request-provided code, host activation or new process adapter" };
}
reviews[descriptor].hash = sourceHash(read(descriptor));
reviews[descriptor].globals.hash = reviews[descriptor].hash;
const transitions = "apps/backend/executionIdentity/transitions.ts";
const expectedTransitions = original(transitions)
  .replace('| "isolation-boundary/1" }>', '| "isolation-boundary/1" | "declared-host-boundary/1" }>')
  .replace('"isolation-boundary/1"].includes', '"isolation-boundary/1", "declared-host-boundary/1"].includes');
if (read(transitions) !== expectedTransitions) throw Error("Only register the new frozen declared-host algorithm");
reviews[transitions].hash = sourceHash(read(transitions));
if (reviews[transitions].globals) reviews[transitions].globals.hash = reviews[transitions].hash;
for (const path of ownership) {
  reviews[path].hash = sourceHash(read(path));
  reviews[path].review = "Captured server work token is persisted before create and propagated unchanged to the Docker label; immutable daemon/token fencing supports orphan recovery; existing process, filesystem and execution permissions unchanged";
}
// Review only exact freshly generated bytes. Schema/generator/dependencies are
// pinned by the descriptor; no path-wide generated-code exception is added.
function generated(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) generated(path);
    else if (path.endsWith(".ts")) reviews[path] = { hash: sourceHash(read(path)), capabilities: ["generated-client"],
      review: "Prisma 7.9.1 generated client for the additive immutable submission schema; fixed literal imports, pinned generator/schema and no authored runtime injected" };
  }
}
generated("apps/backend/lib/generated/prisma");
writeFileSync(reviewPath, JSON.stringify(reviews, null, 2) + "\n");
writeFileSync("docs/reality/first-stack-submission-source-review.json", JSON.stringify({ schema: "first-stack-submission-source-review/1", baseline,
  scope: "Owned immutable browser submissions and serial isolated server verification; Model 1 active; no public route or worker started",
  files: [...modules, ...ownership, "apps/backend/release/firstStackSchema.ts", "apps/backend/release/migrations.ts", descriptor,
    "apps/backend/prisma/schema.prisma", "apps/backend/prisma/migrations/20261021000000_first_stack_submissions/migration.sql",
    transitions, "scripts/historical-declared-host-descriptor.ts", "scripts/frozen-baseline.ts", "scripts/refresh-execution.ts", "scripts/execution-identity.ts"].map(path => ({ path, hash: sourceHash(read(path)) })),
  acceptance: ["apps/backend/tests/firstStackSubmission.test.ts", "apps/backend/tests/firstStackIsolation.test.ts", "apps/backend/tests/submissionFixture.ts", "apps/backend/tests/integration/firstStackSubmission.integration.test.ts",
    "scripts/tests/submissionLineage.test.ts", "scripts/tests/historical-isolation.test.ts", "scripts/tests/futureBaseline.test.ts"].map(path => ({ path, hash: sourceHash(read(path)) })),
}, null, 2) + "\n");
