import { writeTransitionStore } from "./transition-store";
import { loadTransitions } from "../apps/backend/executionIdentity/transitions";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { diskTree, executionDescriptor, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import { digest, lf, sha256, sourceHash } from "../apps/backend/executionIdentity/hash";
import { gitTree } from "./execution-identity";
import { historicalAnalysisDescriptor } from "./historical-analysis-descriptor";
import type { TransitionTable } from "../apps/backend/executionIdentity/transitions";

// This is a single reviewed contract transition, not permission to rewrite physics.
export const baseline = "3837b94eb9a388be402bde3a0ca7fac61e667942";
// Upstream removed unused dependencies and web helpers. Compare stage-0 edits
// with that exact reviewed main, while retaining the original replay baseline.
export const integrationBase = "7b02e3e67e6eec4403a467eedbfe85c39f6e1a58";
const root = repositoryRoot, folder = "apps/backend/executionIdentity/";
const reviewed = new Set([
  ".dockerignore", "apps/backend/Dockerfile",
  "apps/backend/executionIdentity/transitions.ts",
  "apps/backend/actions/persistence.ts", "apps/backend/capabilities/policy.ts", "apps/backend/challenges/improvementRoutes.ts", "apps/backend/challenges/routes.ts",
  "apps/backend/internalModel2/lessonAuthoring.ts", "apps/backend/internalModel2/routes.ts", "apps/backend/internalModel2/store.ts",
  "apps/backend/reports/routes.ts", "apps/backend/reruns/routes.ts", "apps/backend/routes/deployment.routes.ts", "apps/backend/routes/infrastructure.routes.ts",
  "apps/backend/runRecords/adapters.ts", "apps/backend/runRecords/schema.ts", "apps/backend/simulator/simulator.ts",
  "packages/contracts/src/deployment/index.ts", "packages/contracts/src/deployment/CapabilityAvailability.interface.ts",
  "packages/contracts/src/reports/index.ts", "packages/contracts/src/reports/runRecord.ts",
]);
const generated = new Set(["analysisContract.json", "capabilityReviews.json", "capabilityImportReviews.json", "loading.ts", "executionTransitions.json", "transitionPin.json", "resolutionContract.json"].map(p => folder + p));
const put = (path: string, value: unknown) => writeFileSync(resolve(root, path), JSON.stringify(value, null, 2) + "\n");
function assertScope() {
  const old = gitTree(integrationBase), current = diskTree();
  for (const path of current.paths.filter(p => p.startsWith("apps/backend/") || p.startsWith("packages/") || p === ".dockerignore")) {
    if (path.includes("/generated/") || path.startsWith("apps/web/") || generated.has(path) || path === "apps/backend/internalModel2/legacyRuntime.json") continue;
    if ((!old.paths.includes(path) || sourceHash(current.read(path)) !== sourceHash(old.read(path))) && !reviewed.has(path)) throw Error(`Outside stage-0 execution review: ${path}`);
  }
  for (const path of old.paths) if (!current.paths.includes(path)) throw Error(`Stage 0 cannot remove source: ${path}`);
  for (const path of ["bun.lock", "package.json", "bunfig.toml"]) if (current.read(path) !== old.read(path)) throw Error(`Stage 0 cannot change dependency context: ${path}`);
}
export function reviewStage0Syntax() {
  assertScope();
  const path = folder + "capabilityReviews.json", reviews = JSON.parse(readFileSync(resolve(root, path), "utf8"));
  for (const [file, value] of Object.entries(reviews) as Array<[string, { hash: string; globals?: { hash: string } }]>) {
    if (!reviewed.has(file) && file !== folder + "loading.ts") continue;
    const hash = sourceHash(diskTree().read(file));
    value.hash = hash; if (value.globals) value.globals.hash = hash;
  }
  put(path, reviews);
  console.info("Stage-0 syntax hashes reviewed; existing permissions unchanged");
}
export function refreshStage0Transitions() {
  assertScope();
  const currentTree = diskTree();
  const baseTable = JSON.parse(gitTree(baseline).read(folder + "executionTransitions.json")) as TransitionTable;
  const store = loadTransitions(root), { table } = store;
  const previous = baseTable.entries[0]!.target;
  const history = store.history();
  const retain = (commit: string, source: string, stored: TransitionTable["descriptors"][string], review: string) => {
    const frozen = history.trees[commit];
    const tree = frozen ? { paths: Object.keys(frozen), read: (path: string) => {
      const text = history.blobs[frozen[path]!];
      if (text === undefined) throw Error(`Missing frozen stage-0 source: ${path}`);
      return text;
    } } : gitTree(commit);
    const files = stored.files as Array<[string, string]>;
    const paths = [...new Set([...tree.paths, ...files.map(([path]) => path)])].sort();
    const read = (path: string) => {
      if (tree.paths.includes(path)) return tree.read(path);
      const pin = files.find(([file]) => file === path)?.[1];
      if (!path.includes("/generated/") || !pin || sourceHash(currentTree.read(path)) !== pin) throw Error(`Unretained baseline generation: ${path}`);
      return currentTree.read(path);
    };
    const reconstructed = historicalAnalysisDescriptor({ paths, read }, "bun-1.3.14");
    if (digest(reconstructed) !== source) throw Error(`Retained stage-0 descriptor does not reconstruct: ${commit}`);
    const retained = [...new Set([...files.map(([path]) => path), "package.json", "bun.lock", "bunfig.toml", ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(p => p + "/package.json")])];
    history.trees[commit] = Object.fromEntries(retained.map(path => { const text = lf(read(path)), hash = sha256(text); history.blobs[hash] = text; return [path, hash]; }));
    table.descriptors[source] = stored;
    if (!table.entries.some(row => row.source === source)) table.entries.push({ commit, source, descriptor: source, target: source,
      kind: "descriptor", algorithm: "analysis-boundary/1", review });
  };
  retain(baseline, previous, baseTable.descriptors[previous]!, "Stage 0: all-free admission and design/export controls, versioned read-only RunRecord adapters; engine, compiler, stored inputs, dependency lock and operational limits unchanged");
  // The accepted pre-rebase stage-0 identity remains replayable too. Its archived
  // source is sufficient after cloning, even when the old commit is unreachable.
  const accepted = "eb55b982fb58025a377481e44ddfc77ef0beb75771ea6c9d719d46e0208f51ef";
  retain("a77220eb8409b38186bddc38576e1adf45cb460a", accepted, table.descriptors[accepted]!, "Stage-0 rebase onto 7b02e3e: unused dependency/web-helper removals reviewed; execution mechanisms, installed runtime closure and operational limits unchanged");
  const current = executionDescriptor(), target = digest(current);
  table.descriptors[target] = current;
  for (const row of table.entries) row.target = target;
  for (const key of Object.keys(table.descriptors)) if (key !== target && !table.entries.some(row => row.descriptor === key)) delete table.descriptors[key];
  writeTransitionStore(root, table, history);
  console.info(JSON.stringify({ historicalEntries: table.entries.length, previous, current: target }));
}
