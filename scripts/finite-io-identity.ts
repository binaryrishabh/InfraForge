import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { diskTree, executionDescriptor } from "../apps/backend/executionIdentity/descriptor";
import { digest, sha256, sourceHash } from "../apps/backend/executionIdentity/hash";
import { loadTransitions, type TransitionTable } from "../apps/backend/executionIdentity/transitions";
import { gitTree } from "./execution-identity";
import { historicalAnalysisDescriptor } from "./historical-analysis-descriptor";
import { finiteIoAdded, finiteIoChanged, finiteIoReviewPath, type FiniteIoReview } from "./finite-io-source-review";
import { compositionProofs } from "./reality/composition-proofs";

const baseline = "7a75f8b6c09353e54544feb17840dfb25019affb";
const folder = "apps/backend/executionIdentity/";
const generated = ["loading.ts", "capabilityReviews.json", "capabilityImportReviews.json", "analysisContract.json", "resolutionContract.json"].map(p => folder + p);
generated.push("apps/backend/internalModel2/legacyRuntime.json");
const acceptance = ["packages/simulation/tests/finiteIo.test.ts", "packages/simulation/tests/finiteIoFixture.ts", "scripts/tests/finite-io.test.ts", "scripts/fixtures/first-stack-io.ts", "scripts/reality/finite-io-proof.ts", "scripts/tests/execution-identity.test.ts", "scripts/finite-io-identity.ts", "scripts/finite-io-source-review.ts", "scripts/execution-identity.ts", "scripts/stage2-bounds-host.ts", "scripts/reality/composition-host-proof.ts"];
const get = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const put = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
function prior() {
  const tree = gitTree(baseline), table = JSON.parse(tree.read(folder + "executionTransitions.json")) as TransitionTable;
  const source = table.entries[0]!.target, descriptor = table.descriptors[source]!;
  return { tree, source, descriptor };
}
export function writeFiniteIoReview() {
  const old = prior();
  const review: FiniteIoReview = { schema: "finite-io-source-review/1", baseline, source: old.source,
    scope: "Opt-in finite logical storage on the common clock; shared FIFO device/page/WAL owners, explicit compiler/profile/workload identity; historical compositions and generic/PG semantics retained; no activation or timing promotion",
    files: [...finiteIoAdded, ...finiteIoChanged].sort().map(path => ({ path, hash: sourceHash(get(path)), original: finiteIoAdded.includes(path) ? null : old.tree.read(path), originalHash: finiteIoAdded.includes(path) ? null : sourceHash(old.tree.read(path)) })),
    acceptance: acceptance.map(path => ({ path, hash: sourceHash(get(path)) })) };
  put(finiteIoReviewPath, review);
  // Refresh only current-source pins in prior acceptance inventories. Their
  // original source snapshots, scope and historical fixture hashes stay fixed.
  for (const path of ["docs/reality/first-stack-source-review.json", "docs/reality/postgres-session-source-review.json"]) {
    const value = JSON.parse(get(path));
    for (const f of [...value.files, ...value.acceptance]) {
      if (!finiteIoChanged.includes(f.path) && !acceptance.includes(f.path)) continue;
      if (Object.hasOwn(f, "hash")) f.hash = sourceHash(get(f.path));
      // PG file hashes remain at the pre-IO boundary, reconstructed separately.
      else if (value.acceptance.includes(f)) f.sha256 = sourceHash(get(f.path));
    }
    put(path, value);
  }
  return verifyReview();
}
function verifyReview() {
  const old = prior(), review = JSON.parse(get(finiteIoReviewPath)) as FiniteIoReview;
  if (review.baseline !== baseline || review.source !== old.source || digest(review.files.map(f => f.path)) !== digest([...finiteIoAdded, ...finiteIoChanged].sort()) || digest(review.acceptance.map(f => f.path)) !== digest(acceptance)) throw Error("Invalid finite IO review scope");
  for (const f of review.files) {
    if (sourceHash(get(f.path)) !== f.hash || (finiteIoChanged.includes(f.path) && (f.original !== old.tree.read(f.path) || f.originalHash !== sourceHash(f.original)))) throw Error(`IO source requires review: ${f.path}`);
  }
  for (const f of review.acceptance) if (sourceHash(get(f.path)) !== f.hash) throw Error(`IO acceptance requires review: ${f.path}`);
  for (const [path, hash] of old.descriptor.files as [string, string][]) if (![...finiteIoChanged, ...generated].includes(path) && sourceHash(get(path)) !== hash) throw Error(`Outside finite IO integration scope: ${path}`);
  if (digest(compositionProofs()) !== digest(JSON.parse(get("docs/reality/stage1-composition-hashes.json")))) throw Error("Historical composition output changed");
  return old;
}
export function reviewFiniteIoSyntax() {
  verifyReview(); const reviews = JSON.parse(get(folder + "capabilityReviews.json"));
  for (const path of [...finiteIoAdded, ...finiteIoChanged, folder + "loading.ts"]) {
    const hash = sourceHash(get(path)), entry = reviews[path];
    if (entry) { entry.hash = hash; if (entry.globals) entry.globals.hash = hash; }
    else reviews[path] = { hash, capabilities: ["computed-data"], review: "Bounded finite IO arrays/maps and typed same-clock receipts; no loader, evaluator, host IO, network or activation" };
  }
  put(folder + "capabilityReviews.json", reviews);
}
export function reviewFiniteIoImports() {
  verifyReview();
  const path = folder + "capabilityImportReviews.json", approved = JSON.parse(get(path));
  executionDescriptor(diskTree(), `bun-${Bun.version}`, required => {
    for (const [file, hash] of Object.entries(required)) {
      if (approved.modules[file] === hash || approved.alternatives?.[file]?.includes(hash)) continue;
      if (file !== folder + "loading.ts") throw Error(`Outside IO import review: ${file}`);
      approved.modules[file] = hash;
    }
  });
  put(path, approved);
}
export function refreshFiniteIoTransitions() {
  const old = verifyReview(), current = executionDescriptor(), target = digest(current), previous = new Map(old.descriptor.files as [string, string][]);
  for (const [path, hash] of current.files as [string, string][]) if (previous.get(path) !== hash && ![...finiteIoAdded, ...finiteIoChanged, ...generated].includes(path)) throw Error(`Unreviewed finite IO execution addition: ${path}`);
  const { table, pin } = loadTransitions(process.cwd()), archivePath = "scripts/fixtures/execution-identity-history.json.gz", bytes = readFileSync(archivePath);
  if (sha256(bytes.toString("base64")) !== pin.history) throw Error("IO history archive drift");
  const history = JSON.parse(gunzipSync(bytes).toString()) as { blobs: Record<string, string>; trees: Record<string, Record<string, string>> };
  if (!history.trees[baseline]) {
    const paths = [...new Set([...(old.descriptor.files as [string, string][]).map(([path]) => path), "package.json", "bun.lock", "bunfig.toml", ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(p => p + "/package.json")])];
    const texts = new Map(paths.map(path => [path, old.tree.paths.includes(path) ? old.tree.read(path) : get(path)]));
    for (const [path, hash] of old.descriptor.files as [string, string][]) if (sourceHash(texts.get(path)!) !== hash) throw Error(`Cannot retain finite IO baseline: ${path}`);
    if (digest(historicalAnalysisDescriptor({ paths, read: path => texts.get(path)! }, "bun-1.3.14")) !== old.source) throw Error("Finite IO baseline cannot reconstruct");
    history.trees[baseline] = Object.fromEntries(paths.map(path => { const text = texts.get(path)!, hash = sha256(text); history.blobs[hash] = text; return [path, hash]; }));
  }
  table.descriptors[old.source] = old.descriptor;
  if (!table.entries.some(row => row.source === old.source)) table.entries.push({ commit: baseline, source: old.source, descriptor: old.source, target, kind: "descriptor", algorithm: "analysis-boundary/1", review: "Preserve merged bounded first-stack/PG execution; separately opt-in finite IO profile and compiler; eight historical compositions unchanged; no activation or calibration" });
  table.descriptors[target] = current; for (const row of table.entries) row.target = target;
  for (const key of Object.keys(table.descriptors)) if (key !== target && !table.entries.some(row => row.descriptor === key)) delete table.descriptors[key];
  const text = JSON.stringify(table, null, 2) + "\n", archive = gzipSync(JSON.stringify(history), { level: 9 }); archive[9] = 255;
  writeFileSync(folder + "executionTransitions.json", text); writeFileSync(archivePath, archive);
  put(folder + "transitionPin.json", { digest: digest(table), bytes: sha256(text), history: sha256(archive.toString("base64")) });
  console.info(JSON.stringify({ entries: table.entries.length, current: target, historicalCompositions: 8 }));
}
