import { readFileSync, writeFileSync } from "node:fs";
import { sourceHash } from "../apps/backend/executionIdentity/hash";

// Explicit review of this slice's new entrypoints; retain historical runtime
// identities with refresh-execution.ts, not the older stage-specific builders.
if (!process.argv.includes("--write")) throw Error("Use --write after source and capability review");
const folder = "apps/backend/firstStack/";
const modules = ["boundedExecution", "executionCut", "isolationPolicy", "isolationProtocol", "isolationConnection",
  "isolationContainer", "isolationRunner", "isolationChild", "isolationReplay", "isolatedExecution", "isolationOwnership"].map(p => folder + p + ".ts");
const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
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
  schema: "first-stack-isolation-source-review/1", baseline: "f2dff02faaf46f65fa441e722fc5391ea8ae3d77",
  scope: "New isolated execute/replay service boundary; Model 1 active, Model 2 inactive; unchanged IO/fault mechanisms",
  files: [...modules, "apps/backend/executionIdentity/descriptor.ts", "apps/backend/executionIdentity/launch.ts"].map(path => ({ path, hash: sourceHash(read(path)) })),
}, null, 2) + "\n");
console.info(`Reviewed ${modules.length} first-stack containment modules`);
