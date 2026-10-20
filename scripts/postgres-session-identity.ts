import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { diskTree, executionDescriptor, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import { digest, lf, sha256 } from "../apps/backend/executionIdentity/hash";
import { loadTransitions, type TransitionTable } from "../apps/backend/executionIdentity/transitions";
import { historicalAnalysisDescriptor } from "./historical-analysis-descriptor";
import { gitTree } from "./execution-identity";
import { compositionProofs } from "./reality/composition-proofs";

const baseline = "8141673ffcb48d0ac6d9855ea9fe46a563095cc4", folder = "apps/backend/executionIdentity/";
const reviewPath = "docs/reality/postgres-session-source-review.json";
export const pgSources = ["composition/run.ts", "data/contracts.ts", "data/database.ts", "data/modules.ts", "data/run.ts", "data/validate.ts", "network/contracts.ts", "network/transport.ts"].map(p => "packages/simulation/src/model2/" + p).sort();
const generated = ["loading.ts", "capabilityReviews.json", "capabilityImportReviews.json", "analysisContract.json", "resolutionContract.json"].map(p => folder + p);
generated.push("apps/backend/internalModel2/legacyRuntime.json");
const original = (path: string) => lf(execFileSync("git", ["show", `${baseline}:${path}`], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const get = (p: string) => lf(readFileSync(resolve(repositoryRoot, p), "utf8"));
const put = (p: string, data: unknown) => writeFileSync(resolve(repositoryRoot, p), JSON.stringify(data, null, 2) + "\n");
export function reviewPostgresSessions() {
  const old = JSON.parse(original(folder + "executionTransitions.json")) as TransitionTable;
  const source = old.entries[0]!.target;
  const value = { schema: "infraforge-postgres-session-source-review/1", baseline, baselineSource: source,
    scope: "Opt-in m2e-pg/1 only; generic m2e/1 and eight pinned historical composition outputs unchanged; no activation or calibration",
    files: pgSources.map(path => ({ path, originalHash: sha256(original(path)), original: original(path), sha256: sha256(get(path)) })),
    acceptance: ["packages/simulation/tests/postgresSessions.test.ts", "scripts/tests/g5Pilot.test.ts", "scripts/tests/execution-identity.test.ts"].map(path => ({ path, sha256: sha256(get(path)) })) };
  put(reviewPath, value);
  // The compiler's current source-review receipt also pins this shared test.
  // Its original runtime proof and acceptance inventory are preserved.
  const compilerPath = "docs/reality/first-stack-source-review.json", compiler = JSON.parse(get(compilerPath));
  const test = compiler.acceptance.find((f: { path: string }) => f.path === "scripts/tests/execution-identity.test.ts");
  if (!test) throw Error("Missing shared compiler identity acceptance pin");
  test.hash = sha256(get(test.path)); put(compilerPath, compiler);
}
function scope() {
  const reviewed = JSON.parse(get(reviewPath)), old = JSON.parse(original(folder + "executionTransitions.json")) as TransitionTable;
  const source = old.entries[0]!.target, prior = old.descriptors[source]!;
  if (reviewed.baseline !== baseline || reviewed.baselineSource !== source || digest(reviewed.files.map((f: { path: string }) => f.path)) !== digest(pgSources)) throw Error("Invalid PG review scope");
  for (const f of reviewed.files) if (sha256(get(f.path)) !== f.sha256 || sha256(f.original) !== f.originalHash || f.original !== original(f.path)) throw Error(`PG source requires review: ${f.path}`);
  for (const f of reviewed.acceptance) if (sha256(get(f.path)) !== f.sha256) throw Error(`PG acceptance requires review: ${f.path}`);
  const tree = diskTree();
  for (const [path, hash] of prior.files as [string, string][]) if (!pgSources.includes(path) && !generated.includes(path) && sha256(tree.read(path)) !== hash) throw Error(`Outside PG integration scope: ${path}`);
  for (const path of ["bun.lock", "package.json", "bunfig.toml", "apps/backend/package.json", "apps/web/package.json", ...["catalog", "domain", "contracts", "simulation"].map(p => `packages/${p}/package.json`)]) if (lf(get(path)) !== original(path)) throw Error(`PG dependency scope: ${path}`);
  return { reviewed, tree, source, prior };
}
export function reviewPostgresSyntax() {
  scope();
  const reviews = JSON.parse(get(folder + "capabilityReviews.json"));
  for (const path of [...pgSources, folder + "loading.ts"]) {
    const entry = reviews[path]; if (!entry) continue;
    const hash = sha256(get(path)); entry.hash = hash; if (entry.globals) entry.globals.hash = hash;
  }
  put(folder + "capabilityReviews.json", reviews);
}
export function refreshPostgresTransitions() {
  if (digest(compositionProofs()) !== digest(JSON.parse(get("docs/reality/stage1-composition-hashes.json")))) throw Error("Historical composition behavior changed");
  const { tree, source, prior } = scope(), current = executionDescriptor(), target = digest(current);
  const allowed = new Set([...pgSources, ...generated]), previous = new Map(prior.files as [string, string][]);
  for (const [path, hash] of current.files as [string, string][]) if (previous.get(path) !== hash && !allowed.has(path)) throw Error(`Unreviewed PG execution addition: ${path}`);
  const { table, pin } = loadTransitions(repositoryRoot), archivePath = "scripts/fixtures/execution-identity-history.json.gz";
  const bytes = readFileSync(resolve(repositoryRoot, archivePath));
  if (sha256(bytes.toString("base64")) !== pin.history) throw Error("PG history pin drift");
  const history = JSON.parse(gunzipSync(bytes).toString()) as { blobs: Record<string, string>; trees: Record<string, Record<string, string>> };
  if (!history.trees[baseline]) {
    const old = gitTree(baseline), paths = [...new Set([...(prior.files as [string, string][]).map(([p]) => p), "package.json", "bun.lock", "bunfig.toml", ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(p => p + "/package.json")])];
    const texts = new Map(paths.map(path => [path, old.paths.includes(path) ? old.read(path) : tree.read(path)]));
    for (const [path, hash] of prior.files as [string, string][]) if (sha256(texts.get(path)!) !== hash) throw Error(`Cannot retain PG baseline: ${path}`);
    if (digest(historicalAnalysisDescriptor({ paths, read: path => texts.get(path)! }, "bun-1.3.14")) !== source) throw Error("PG baseline descriptor does not reconstruct");
    history.trees[baseline] = Object.fromEntries(paths.map(path => { const text = texts.get(path)!, hash = sha256(text); history.blobs[hash] = text; return [path, hash]; }));
  }
  table.descriptors[source] = prior;
  if (!table.entries.some(row => row.source === source)) table.entries.push({ commit: baseline, source, descriptor: source, target, kind: "descriptor", algorithm: "analysis-boundary/1", review: "Stage 2 PostgreSQL sessions: preserve generic m2e/1 and eight historical replays; separately revisioned PG connection/deadline/commit profile and local G5; no Model 2 activation" });
  table.descriptors[target] = current; for (const row of table.entries) row.target = target;
  for (const key of Object.keys(table.descriptors)) if (key !== target && !table.entries.some(row => row.descriptor === key)) delete table.descriptors[key];
  const text = JSON.stringify(table, null, 2) + "\n", archive = gzipSync(JSON.stringify(history), { level: 9 }); archive[9] = 255;
  writeFileSync(resolve(repositoryRoot, folder + "executionTransitions.json"), text); writeFileSync(resolve(repositoryRoot, archivePath), archive);
  put(folder + "transitionPin.json", { digest: digest(table), bytes: sha256(text), history: sha256(archive.toString("base64")) });
  console.log(JSON.stringify({ entries: table.entries.length, current: target, historicalCompositions: 8 }));
}
