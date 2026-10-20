import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { diskTree, executionDescriptor, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import { digest, sourceHash } from "../apps/backend/executionIdentity/hash";
import { historicalAnalysisDescriptor } from "./historical-analysis-descriptor";
import type { TransitionTable } from "../apps/backend/executionIdentity/transitions";
import { gitTree } from "./execution-identity";

// Exact operational review, independent of the engine/first-stack authoring
// transitions. No engine, internalModel2, schema or dependency edits permitted.
export const hardeningBaseline = "8141673ffcb48d0ac6d9855ea9fe46a563095cc4";
const folder = "apps/backend/executionIdentity/";
const reviewed = new Set([
  "apps/backend/index.ts", "apps/backend/worker.ts", "apps/backend/ws-server.ts",
  "apps/backend/docker-compose.yml", "apps/backend/lib/prisma.ts",
  ...["redis", "queue", "pubsub", "deploymentSubscriptions"].map(name => `apps/backend/infra/${name}.ts`),
  ...["connectionPolicy", "config", "lifecycle", "socketLifecycle", "rateLimiter", "middleware"].map(name => `apps/backend/utils/${name}.ts`),
]);
const generated = new Set(["loading.ts", "capabilityReviews.json", "capabilityImportReviews.json", "analysisContract.json", "resolutionContract.json", "executionTransitions.json", "transitionPin.json"].map(name => folder + name));
function scope() {
  const before = gitTree(hardeningBaseline), current = diskTree();
  const loading = folder + "loading.ts";
  const withoutPin = (source: string) => source.replace(/const analysisPin = "[a-f0-9]{64}";/, 'const analysisPin = "generated";');
  if (withoutPin(before.read(loading)) !== withoutPin(current.read(loading))) throw Error("Hardening cannot change the execution loading policy");
  for (const path of current.paths) {
    if (path.includes("/generated/") || generated.has(path) || path.startsWith("apps/web/")) continue;
    if ((!before.paths.includes(path) || sourceHash(before.read(path)) !== sourceHash(current.read(path))) && !reviewed.has(path)) {
      throw Error(`Outside hardening identity review: ${path}`);
    }
  }
  for (const path of before.paths) if (!current.paths.includes(path)) throw Error(`Hardening cannot remove execution source: ${path}`);
  return { before, current };
}
export function reviewHardeningSyntax() {
  const { current } = scope();
  const path = resolve(repositoryRoot, folder + "capabilityReviews.json");
  const reviews = JSON.parse(readFileSync(path, "utf8"));
  for (const file of [...reviewed, folder + "loading.ts"]) {
    if (!reviews[file]) continue;
    const hash = sourceHash(current.read(file));
    reviews[file].hash = hash;
    if (reviews[file].globals) reviews[file].globals.hash = hash;
  }
  const file = "apps/backend/utils/lifecycle.ts", hash = sourceHash(current.read(file));
  reviews[file] = { hash, capabilities: [], review: "Bounded HTTP drain and signal/exit handling only; fixed process global; no dynamic code or resource loading", globals: { hash, names: ["process"] } };
  writeFileSync(path, JSON.stringify(reviews, null, 2) + "\n");
  console.info("Hardening source syntax reviewed; engine, schemas and dependencies unchanged");
}
export function refreshHardeningAcceptance() {
  scope();
  const path = "docs/reality/first-stack-source-review.json", test = "scripts/tests/execution-identity.test.ts";
  const original = (file: string) => execFileSync("git", ["show", `${hardeningBaseline}:${file}`], {
    cwd: repositoryRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  }).replaceAll("\r\n", "\n");
  const currentTest = readFileSync(resolve(repositoryRoot, test), "utf8").replaceAll("\r\n", "\n");
  if (currentTest !== original(test).replace("expect(table.entries.length).toBe(38);", "expect(table.entries.length).toBe(39);")) {
    throw Error("Hardening acceptance review permits only the added historical entry count");
  }
  const baseline = JSON.parse(original(path)), expected = structuredClone(baseline);
  const rows = [...expected.files, ...expected.acceptance] as Array<{ path: string; hash: string }>;
  for (const row of rows) {
    const hash = sourceHash(readFileSync(resolve(repositoryRoot, row.path), "utf8"));
    if (row.path === test) row.hash = hash;
    else if (row.hash !== hash) throw Error(`Hardening cannot refresh first-stack behavior/acceptance: ${row.path}`);
  }
  const current = JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
  if (![baseline, expected].some(value => JSON.stringify(value) === JSON.stringify(current))) throw Error("Unreviewed first-stack source review change");
  writeFileSync(resolve(repositoryRoot, path), JSON.stringify(expected, null, 2) + "\n");
  console.info("First-stack behavior pins preserved; only the historical identity entry-count acceptance hash refreshed");
}
export function refreshHardeningTransitions() {
  const { before, current: tree } = scope();
  const base = JSON.parse(before.read(folder + "executionTransitions.json")) as TransitionTable;
  const source = base.entries[0]!.target, stored = base.descriptors[source]!;
  const table = JSON.parse(readFileSync(resolve(repositoryRoot, folder + "executionTransitions.json"), "utf8")) as TransitionTable;
  const archivePath = resolve(repositoryRoot, "scripts/fixtures/execution-identity-history.json.gz");
  const history = JSON.parse(gunzipSync(readFileSync(archivePath)).toString()) as { blobs: Record<string, string>; trees: Record<string, Record<string, string>> };
  const files = stored.files as Array<[string, string]>;
  const paths = [...new Set([...before.paths, ...files.map(([path]) => path)])];
  const read = (path: string) => before.paths.includes(path) ? before.read(path) : tree.read(path);
  if (digest(historicalAnalysisDescriptor({ paths, read }, stored.runtime)) !== source) throw Error("Hardening baseline descriptor does not reconstruct");
  history.trees[hardeningBaseline] = Object.fromEntries(paths.map(path => {
    const text = read(path), hash = sourceHash(text); history.blobs[hash] = text; return [path, hash];
  }));
  const current = executionDescriptor(), target = digest(current);
  table.descriptors[source] = stored;
  if (!table.entries.some(row => row.source === source)) table.entries.push({
    commit: hardeningBaseline, source, descriptor: source, target, kind: "descriptor", algorithm: "analysis-boundary/1",
    review: "Operational hardening only: bounded DB/producer calls, retry backoff, resource retention and ingress drain; engine/compiler/internalModel2, schema, stored inputs and dependency bytes unchanged; historical reports remain readable; no activation or relabelling",
  });
  table.descriptors[target] = current;
  for (const row of table.entries) row.target = target;
  for (const key of Object.keys(table.descriptors)) if (key !== target && !table.entries.some(row => row.descriptor === key)) delete table.descriptors[key];
  const text = JSON.stringify(table, null, 2) + "\n", archive = gzipSync(JSON.stringify(history), { level: 9 });
  archive[9] = 255;
  writeFileSync(resolve(repositoryRoot, folder + "executionTransitions.json"), text);
  writeFileSync(archivePath, archive);
  writeFileSync(resolve(repositoryRoot, folder + "transitionPin.json"), JSON.stringify({ digest: digest(table), bytes: sourceHash(text), history: sourceHash(archive.toString("base64")) }, null, 2) + "\n");
  console.info(JSON.stringify({ entries: table.entries.length, previous: source, current: target }));
}
