import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { diskTree, executionDescriptor, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import { digest, lf, sha256 } from "../apps/backend/executionIdentity/hash";
import { loadTransitions } from "../apps/backend/executionIdentity/transitions";
import { historicalAnalysisDescriptor } from "./historical-analysis-descriptor";
import { compositionProofs } from "./reality/composition-proofs";
import { verifyCompositionHost } from "./reality/composition-host-proof";

const root = repositoryRoot, folder = "apps/backend/executionIdentity/";
const baseline = JSON.parse(readFileSync(resolve(root, "docs/reality/first-stack-baseline.json"), "utf8"));
const lockPath = "docs/reality/first-stack-source-review.json";
const added = ["authoring", "canonical", "importStream", "persistence", "routes", "service", "workload"].map(p => `apps/backend/firstStack/${p}.ts`);
added.push("packages/contracts/src/first-stack/index.ts");
const changed = ["apps/backend/internalModel2/routes.ts", "apps/backend/zod_schemas/layout.schema.ts", "apps/backend/Dockerfile", ".dockerignore", "packages/contracts/package.json"];
const generated = ["loading.ts", "capabilityReviews.json", "capabilityImportReviews.json", "analysisContract.json", "resolutionContract.json"].map(p => folder + p);
generated.push("apps/backend/internalModel2/legacyRuntime.json");
let retainedOriginal: { blobs: Record<string, string>; trees: Record<string, Record<string, string>> } | undefined;
let gitOriginal: Map<string, string> | undefined;
const original = (path: string) => {
  // The reviewed baseline is retained after the first transition, so this also
  // works in a final-HEAD-only Linux checkout without the old Git objects.
  const archive = retainedOriginal ??= JSON.parse(gunzipSync(readFileSync(resolve(root, "scripts/fixtures/execution-identity-history.json.gz"))).toString());
  const pin = archive.trees[baseline.commit]?.[path];
  if (pin) return archive.blobs[pin]!;
  if (!gitOriginal) {
    const paths = [...new Set<string>([...baseline.descriptor.files.map(([p]: [string, string]) => p).filter((p: string) => !p.includes("/generated/")), "package.json", "bun.lock", "bunfig.toml", ...["apps/backend", "apps/web", "packages/domain", "packages/catalog", "packages/contracts", "packages/simulation"].map(p => p + "/package.json")])];
    const bytes = execFileSync("git", ["cat-file", "--batch"], { cwd: root, input: paths.map(p => `${baseline.commit}:${p}\n`).join(""), maxBuffer: 64 * 1024 * 1024 });
    gitOriginal = new Map(); let offset = 0;
    for (const p of paths) {
      const end = bytes.indexOf(10, offset), size = Number(bytes.subarray(offset, end).toString().split(" ")[2]);
      if (!Number.isSafeInteger(size)) throw Error(`Missing accepted baseline source: ${p}`);
      gitOriginal.set(p, lf(bytes.subarray(end + 1, end + 1 + size).toString())); offset = end + 1 + size + 1;
    }
  }
  const text = gitOriginal.get(path);
  if (text === undefined) throw Error(`Missing accepted baseline source: ${path}`);
  return text;
};
function scope() {
  const tree = diskTree(), same = (path: string, text: string) => { if (text !== original(path)) throw Error(`Outside Stage 2 authoring integration scope: ${path}`); };
  same(changed[0]!, tree.read(changed[0]!).replace('import { createFirstStackRouter } from "../firstStack/routes";\n', "").replace('import { firstStackRepository } from "../firstStack/persistence";\n', "").replace('internalModel2Router.use("/first-stack", createFirstStackRouter(firstStackRepository));\n', ""));
  same(changed[1]!, tree.read(changed[1]!).replace('  // Internal semantic review data is additive; stale drafts remain readable.\n  firstStack: z.json().optional(),\n', ""));
  same(changed[2]!, tree.read(changed[2]!).replace('COPY apps/backend/firstStack ./apps/backend/firstStack/\n', ""));
  same(changed[3]!, tree.read(changed[3]!).replace('!apps/backend/firstStack/\napps/backend/firstStack/**\n!apps/backend/firstStack/*.ts\n', ""));
  const manifest = JSON.parse(tree.read(changed[4]!));
  if (manifest.exports["./first-stack"] !== "./src/first-stack/index.ts") throw Error("Unexpected first-stack export");
  delete manifest.exports["./first-stack"];
  if (digest(manifest) !== digest(JSON.parse(original(changed[4]!)))) throw Error("Dependency or other export change requires a separate review");
  const previous = new Map<string, string>(baseline.descriptor.files);
  for (const path of tree.paths.filter(p => p.startsWith("apps/backend/firstStack/") || p.startsWith("packages/contracts/src/first-stack/"))) if (!added.includes(path)) throw Error(`Unreviewed authoring module: ${path}`);
  // All existing engine/dependency/host sources must retain their accepted bytes.
  for (const [path, hash] of previous) {
    if (changed.includes(path) || generated.includes(path)) continue;
    if (!tree.paths.includes(path) || sha256(tree.read(path)) !== hash) throw Error(`Existing execution source changed: ${path}`);
  }
  for (const path of ["bun.lock", "package.json", "bunfig.toml", "apps/backend/package.json", "apps/web/package.json", ...["domain", "catalog", "simulation"].map(p => `packages/${p}/package.json`)]) same(path, tree.read(path));
  return tree;
}
export function reviewStage2Modules() {
  const tree = scope(), file = resolve(root, folder + "capabilityReviews.json"), reviews = JSON.parse(readFileSync(file, "utf8"));
  for (const path of added) {
    const globals = path.endsWith("workload.ts") ? ["Uint8Array", "TextDecoder", "setImmediate"] : path.endsWith("importStream.ts") ? ["Uint8Array", "TextDecoder"] : [];
    const hash = sha256(tree.read(path));
    reviews[path] = { hash, capabilities: ["computed-data"], ...(globals.length ? { globals: { hash, names: globals } } : {}),
      review: "Internal authoring/stream parser only: bounded fixed JSON data indexing, exact named UTF-8/byte primitives; no evaluator, dynamic loader, engine dispatch or activation" };
  }
  writeFileSync(file, JSON.stringify(reviews, null, 2) + "\n");
}
export function writeStage2ReviewLock() {
  const tree = scope();
  writeFileSync(resolve(root, lockPath), JSON.stringify({ schema: "infraforge-first-stack-source-review/1", baseline: baseline.source,
    scope: "Internal sidecar save/review and recorded schedule resolution only; no execution or activation",
    files: [...added, ...changed].sort().map(path => ({ path, hash: sha256(tree.read(path)) })),
    acceptance: ["apps/backend/tests/firstStackAuthoring.test.ts", "apps/backend/tests/firstStackWorkload.test.ts", "apps/backend/tests/firstStackRoutes.test.ts", "apps/backend/tests/firstStackFixture.ts"].map(path => ({ path, hash: sha256(tree.read(path)) })),
  }, null, 2) + "\n");
}
export function buildStage2Transitions() {
  const tree = scope(), lock = JSON.parse(readFileSync(resolve(root, lockPath), "utf8"));
  if (lock.baseline !== baseline.source || digest(lock.files.map((p: { path: string }) => p.path)) !== digest([...added, ...changed].sort())) throw Error("Invalid authoring review lock");
  for (const { path, hash } of [...lock.files, ...lock.acceptance]) if (sha256(tree.read(path)) !== hash) throw Error(`Authoring source needs review: ${path}`);
  verifyCompositionHost();
  if (digest(compositionProofs()) !== digest(baseline.compositions)) throw Error("Historical composition evidence changed");
  const current = executionDescriptor(), target = digest(current), allowed = new Set([...added, ...changed, ...generated]);
  for (const [path, hash] of current.files) if (new Map(baseline.descriptor.files).get(path) !== hash && !allowed.has(path!)) throw Error(`Unreviewed execution addition: ${path}`);
  const { table, pin } = loadTransitions(root);
  const archivePath = resolve(root, "scripts/fixtures/execution-identity-history.json.gz"), archive = readFileSync(archivePath);
  if (sha256(archive.toString("base64")) !== pin.history) throw Error("History archive changed");
  const history = JSON.parse(gunzipSync(archive).toString()) as { blobs: Record<string, string>; trees: Record<string, Record<string, string>> };
  if (!history.trees[baseline.commit]) {
    const paths = [...new Set<string>([...baseline.descriptor.files.map(([p]: [string, string]) => p), "package.json", "bun.lock", "bunfig.toml", ...["apps/backend", "apps/web", "packages/domain", "packages/catalog", "packages/contracts", "packages/simulation"].map(p => p + "/package.json")])];
    history.trees[baseline.commit] = Object.fromEntries(paths.map(path => {
      const text = path.includes("/generated/") ? tree.read(path) : original(path), hash = sha256(text);
      const expected = new Map(baseline.descriptor.files).get(path);
      if (expected && expected !== hash) throw Error(`Baseline source does not match accepted descriptor: ${path}`);
      history.blobs[hash] = text; return [path, hash];
    }));
  }
  const frozen = history.trees[baseline.commit]!;
  if (digest(historicalAnalysisDescriptor({ paths: Object.keys(frozen), read: path => history.blobs[frozen[path]!]! }, "bun-1.3.14")) !== baseline.source) throw Error("Stage 1 baseline cannot be reconstructed");
  table.descriptors[baseline.source] = baseline.descriptor;
  if (!table.entries.some(row => row.source === baseline.source)) table.entries.push({ commit: baseline.commit, source: baseline.source, descriptor: baseline.source, target, kind: "descriptor", algorithm: "analysis-boundary/1",
    review: "Stage 2 authoring only: exact scoped internal review/save/import additions; Stage 1 and all legacy runtime bytes/eight replay hashes preserved; no first-stack executor or activation" });
  table.descriptors[target] = current;
  for (const row of table.entries) row.target = target;
  for (const key of Object.keys(table.descriptors)) if (key !== target && !table.entries.some(row => row.descriptor === key)) delete table.descriptors[key];
  const text = JSON.stringify(table, null, 2) + "\n", output = gzipSync(JSON.stringify(history), { level: 9 }); output[9] = 255;
  writeFileSync(resolve(root, folder + "executionTransitions.json"), text); writeFileSync(archivePath, output);
  writeFileSync(resolve(root, folder + "transitionPin.json"), JSON.stringify({ digest: digest(table), bytes: sha256(text), history: sha256(output.toString("base64")) }, null, 2) + "\n");
  console.info(JSON.stringify({ entries: table.entries.length, current: target, preservedCompositions: 8 }));
}
