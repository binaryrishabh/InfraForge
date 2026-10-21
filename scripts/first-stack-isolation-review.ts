import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { sourceHash } from "../apps/backend/executionIdentity/hash";

// Explicit review of this slice's new entrypoints; retain historical runtime
// identities with refresh-execution.ts, not the older stage-specific builders.
if (!process.argv.includes("--write")) throw Error("Use --write after source and capability review");
const folder = "apps/backend/firstStack/";
const modules = ["boundedExecution", "executionCut", "isolationPolicy", "isolationProtocol", "isolationConnection",
  "isolationContainer", "isolationRunner", "isolationChild", "isolationReplay", "isolatedExecution", "isolationOwnership"].map(p => folder + p + ".ts");
const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const baseline = "5278b1444e113040677b081a56ead1bcbb4b84d3";
const original = (path: string) => execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).replaceAll("\r\n", "\n");
const acceptancePath = "scripts/tests/execution-identity.test.ts";
const expectedAcceptance = original(acceptancePath).replace("  expect(table.entries.length).toBe(45);",
  '  expect(table.entries.length).toBe(46);\n  expect(table.entries.some((row: { commit: string }) => row.commit === "5278b1444e113040677b081a56ead1bcbb4b84d3")).toBe(true);');
if (read(acceptancePath) !== expectedAcceptance) throw Error("Isolation acceptance permits only the new main transition count and retained baseline assertion");
const lockPath = "docs/reality/first-stack-source-review.json", before = JSON.parse(original(lockPath)), expected = structuredClone(before);
for (const row of [...expected.files, ...expected.acceptance]) {
  const hash = sourceHash(read(row.path));
  if ([folder + "boundedExecution.ts", acceptancePath].includes(row.path)) row.hash = hash;
  else if (row.hash !== hash) throw Error(`Outside isolation source/acceptance review: ${row.path}`);
}
const current = JSON.parse(read(lockPath));
if (![before, expected].some(value => JSON.stringify(value) === JSON.stringify(current))) throw Error("Unrelated first-stack source review changed");
writeFileSync(lockPath, JSON.stringify(expected, null, 2) + "\n");
const loadingPath = "apps/backend/executionIdentity/loading.ts";
const adapter = `normalized.endsWith("apps/backend/firstStack/isolationConnection.ts") && sourceHash(text) === "${sourceHash(read(folder + "isolationConnection.ts"))}"`;
let loading = read(loadingPath);
if (loading.includes('normalized.endsWith("apps/backend/firstStack/isolationConnection.ts")')) {
  loading = loading.replace(/normalized\.endsWith\("apps\/backend\/firstStack\/isolationConnection\.ts"\) && sourceHash\(text\) === "[a-f0-9]{64}"/, adapter);
} else loading = loading.replace(/(const processAdapter = [^\n]+);/, `$1 ||\n    ${adapter};`);
writeFileSync(loadingPath, loading);
const reviewPath = "apps/backend/executionIdentity/capabilityReviews.json", reviews = JSON.parse(read(reviewPath));
for (const path of modules) {
  const hash = sourceHash(read(path));
  const globals = ["boundedExecution.ts", "isolationConnection.ts", "isolationChild.ts"].some(p => path.endsWith(p)) ? ["process"] : [];
  reviews[path] = { hash, capabilities: ["computed-data", ...(["isolationConnection.ts", "isolationChild.ts"].some(p => path.endsWith(p)) ? ["resources"] : [])],
    ...(globals.length ? { globals: { hash, names: globals } } : {}),
    review: "Isolated first-stack data protocol, fixed local Docker CLI, cgroup/rlimit inspection, finite stream framing and durable event-prefix replay; no arbitrary evaluator or code supplied by a run; no public dispatch or Model 2 activation" };
}
for (const path of ["apps/backend/executionIdentity/loading.ts", "apps/backend/executionIdentity/descriptor.ts", "apps/backend/executionIdentity/launch.ts"]) {
  reviews[path].hash = sourceHash(read(path));
  if (reviews[path].globals) reviews[path].globals.hash = reviews[path].hash;
}
writeFileSync(reviewPath, JSON.stringify(reviews, null, 2) + "\n");
writeFileSync("docs/reality/first-stack-isolation-source-review.json", JSON.stringify({
  schema: "first-stack-isolation-source-review/1", baseline,
  scope: "New isolated execute/replay service boundary; Model 1 active, Model 2 inactive; unchanged IO/fault mechanisms",
  files: [...modules, "apps/backend/executionIdentity/descriptor.ts", "apps/backend/executionIdentity/launch.ts"].map(path => ({ path, hash: sourceHash(read(path)) })),
}, null, 2) + "\n");
console.info(`Reviewed ${modules.length} first-stack containment modules`);
