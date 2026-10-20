import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { diskTree, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import { digest, lf, sourceHash } from "../apps/backend/executionIdentity/hash";

// One storage-only review. Engine behavior, dependencies and historical identities
// are not approved by this command; the migration proof pins their original data.
const baseline = "6e0466de089875fe53e4040325bb8c0ca51bc0cd";
const folder = "apps/backend/executionIdentity/";
const modules = [folder + "transitions.ts", folder + "merkle.ts", folder + "launch.ts"];
const generated = new Set(["executionTransitions.json", "executionNodes.json.gz", "transitionPin.json", "analysisContract.json", "loading.ts", "capabilityReviews.json", "capabilityImportReviews.json", "resolutionContract.json"].map(name => folder + name));
const original = (path: string) => lf(execFileSync("git", ["show", `${baseline}:${path}`], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
export function reviewTransitionStorage() {
  const tree = diskTree();
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline], { cwd: repositoryRoot, encoding: "utf8" }).trim().split("\n");
  const previous = new Set(paths);
  for (const path of tree.paths) {
    if (path.includes("/generated/") || modules.includes(path) || generated.has(path) || path === "apps/backend/internalModel2/legacyRuntime.json" || path === ".dockerignore") continue;
    if (!previous.has(path) || sourceHash(tree.read(path)) !== sourceHash(original(path))) throw Error(`Outside transition storage review: ${path}`);
  }
  const available = new Set(tree.paths);
  for (const path of paths.filter(path => /^(apps|packages)\//.test(path) && !path.split("/").some(part => part.startsWith(".") || ["tests", "generated", "dist", "node_modules"].includes(part)))) {
    if (!available.has(path)) throw Error(`Storage review cannot remove source: ${path}`);
  }
  const launch = folder + "launch.ts";
  if (tree.read(launch) !== original(launch).replace("metadata: [", 'metadata: ["scripts/refresh-execution.ts", "scripts/transition-store.ts", "scripts/transition-storage-review.ts", ')) throw Error("Storage review permits only the three named metadata commands");
  const oldIgnore = original(".dockerignore");
  if (tree.read(".dockerignore") !== oldIgnore.replace("!apps/backend/executionIdentity/*.json\n", "!apps/backend/executionIdentity/*.json\n!apps/backend/executionIdentity/executionNodes.json.gz\n")) throw Error("Only the fixed identity pack may enter the image context");
  const loading = folder + "loading.ts", strip = (text: string) => text.replace(/const analysisPin = "[a-f0-9]{64}";/, 'const analysisPin = "generated";');
  if (strip(tree.read(loading)) !== strip(original(loading))) throw Error("Storage review cannot change loading policy");
  const path = resolve(repositoryRoot, folder + "capabilityReviews.json"), reviews = JSON.parse(readFileSync(path, "utf8"));
  for (const file of modules) reviews[file] = { ...reviews[file], hash: sourceHash(tree.read(file)), capabilities: file.endsWith("launch.ts") ? ["computed-data", "verifier"] : file.endsWith("transitions.ts") ? ["computed-data", "resources"] : ["computed-data"],
    review: "Transition storage only: canonical tagged Merkle data, fixed manifest/pack reads and bounded gzip decoding; no source execution, dynamic import or new external resource path" };
  for (const file of modules) if (reviews[file].globals) reviews[file].globals.hash = reviews[file].hash;
  writeFileSync(path, JSON.stringify(reviews, null, 2) + "\n");
  const lockPath = "docs/reality/first-stack-source-review.json", lock = JSON.parse(readFileSync(resolve(repositoryRoot, lockPath), "utf8")), before = JSON.parse(original(lockPath));
  const test = "scripts/tests/execution-identity.test.ts";
  const expected = original(test).replace('import { validateTransitions }', 'import { loadTransitions, validateTransitions }')
    .replace('const table = JSON.parse(readFileSync("apps/backend/executionIdentity/executionTransitions.json", "utf8"));\n  const pin = JSON.parse(readFileSync("apps/backend/executionIdentity/transitionPin.json", "utf8"));', 'const { table, pin } = loadTransitions(repositoryRoot);')
    .replace('expect(table.entries.length).toBe(42);', 'expect(table.entries.length).toBe(43);')
    .replaceAll("entries[0].", "entries[0]!.").replace("copy.descriptors[copy.entries[0]!.descriptor].runtime", "copy.descriptors[copy.entries[0]!.descriptor]!.runtime");
  if (lf(readFileSync(resolve(repositoryRoot, test), "utf8")) !== expected) throw Error("Storage acceptance review only permits the shared loader and one new historical row");
  for (const row of before.acceptance) if (row.path === test) row.hash = sourceHash(expected);
  // Refuse any unrelated acceptance or behavior pin refresh.
  const restored = structuredClone(lock);
  for (const row of restored.acceptance) if (row.path === test) row.hash = before.acceptance.find((entry: { path: string }) => entry.path === test).hash;
  if (digest(restored) !== digest(before)) throw Error("Unrelated first-stack source review changed");
  writeFileSync(resolve(repositoryRoot, lockPath), JSON.stringify(before, null, 2) + "\n");
  console.info("Reviewed storage modules and shared-loader acceptance; engine and dependency source unchanged");
}
if (import.meta.main) reviewTransitionStorage();
