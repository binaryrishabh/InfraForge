import { writeTransitionStore } from "./transition-store";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { diskTree, executionDescriptor, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import type { SourceTree } from "../apps/backend/executionIdentity/descriptor";
import { digest, lf, sha256 } from "../apps/backend/executionIdentity/hash";
import type { TransitionTable } from "../apps/backend/executionIdentity/transitions";
import { loadTransitions } from "../apps/backend/executionIdentity/transitions";
import { historicalAnalysisDescriptor } from "./historical-analysis-descriptor";
import { compositionProofs } from "./reality/composition-proofs";
import { verifyCompositionHost } from "./reality/composition-host-proof";
import { gitTree } from "./execution-identity";

// Exact accepted integration points, not a general transition approval command.
const main = "31c4a92c18ae3b191eea4cedc115f2a1955959b5";
const composition = "c0df52cd00cf223029f283df711971cdff558fe8";
const acceptedComposition = "2d2a4ae6bfc6a9bf99f8fee4f9a0d0afba3e44e55e957e65b9e28482efb9aa6f";
const folder = "apps/backend/executionIdentity/";
const archivePath = "scripts/fixtures/execution-identity-history.json.gz";
type History = { blobs: Record<string, string>; trees: Record<string, Record<string, string>> };
const gitBytes = (commit: string, path: string) => execFileSync("git", ["show", `${commit}:${path}`], { cwd: repositoryRoot, maxBuffer: 64 * 1024 * 1024 });
const json = (commit: string, path: string) => JSON.parse(lf(gitBytes(commit, path).toString()));

export function buildCompositionTransitions() {
  verifyCompositionHost();
  const currentTree = diskTree(), current = executionDescriptor(), target = digest(current);
  const expected = JSON.parse(readFileSync(resolve(repositoryRoot, "docs/reality/stage1-composition-hashes.json"), "utf8"));
  if (JSON.stringify(compositionProofs()) !== JSON.stringify(expected)) throw Error("Pinned composition replay changed");
  const table: TransitionTable = json(main, folder + "executionTransitions.json");
  const prior = table.descriptors[table.entries[0]!.target]!;
  const generated = new Set(["loading.ts", "capabilityReviews.json", "capabilityImportReviews.json", "analysisContract.json", "resolutionContract.json"].map(p => folder + p));
  generated.add("apps/backend/internalModel2/legacyRuntime.json");
  const files = new Map(prior.files as [string, string][]);
  for (const [path, hash] of current.files as [string, string][]) {
    if (path.startsWith("packages/simulation/src/model2/") || generated.has(path)) continue;
    if (files.get(path) !== hash) throw Error(`Outside composition integration scope: ${path}`);
  }
  for (const [path] of files) if (!current.files.some(([file]) => file === path)) throw Error(`Removed execution source: ${path}`);
  for (const path of ["bun.lock", "package.json", "bunfig.toml", "apps/backend/package.json", "apps/web/package.json", ...["catalog", "contracts", "domain", "simulation"].map(p => `packages/${p}/package.json`)]) {
    if (currentTree.read(path) !== lf(gitBytes(main, path).toString())) throw Error(`Unreviewed dependency context: ${path}`);
  }
  const history: History = { blobs: {}, trees: {} };
  const retain = (commit: string, sourceTable: TransitionTable, source: string) => {
    const stored = sourceTable.descriptors[source]!;
    const frozen = history.trees[commit];
    const baseline: SourceTree = frozen ? { paths: Object.keys(frozen), read: path => {
      const text = history.blobs[frozen[path]!];
      if (text === undefined) throw Error(`Missing retained source: ${commit}:${path}`);
      return text;
    } } : gitTree(commit);
    const pinned = new Map(stored.files as [string, string][]);
    const tree: SourceTree = { paths: [...new Set([...baseline.paths, ...pinned.keys()])], read: path => {
      if (baseline.paths.includes(path)) return baseline.read(path);
      const text = currentTree.read(path);
      if (!path.includes("/generated/") || sha256(text) !== pinned.get(path)) throw Error(`Missing retained output: ${commit}:${path}`);
      return text;
    } };
    if (digest(historicalAnalysisDescriptor(tree, "bun-1.3.14")) !== source) throw Error(`Accepted descriptor does not reconstruct: ${commit}`);
    const paths = [...new Set([...pinned.keys(), "package.json", "bun.lock", "bunfig.toml", ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(p => p + "/package.json")])];
    history.trees[commit] = Object.fromEntries(paths.map(path => { const text = lf(tree.read(path)), hash = sha256(text); history.blobs[hash] = text; return [path, hash]; }));
    if (!table.entries.some(row => row.source === source)) table.entries.push({ commit, source, descriptor: source, target, kind: "descriptor", algorithm: "analysis-boundary/1", review: "Stage 1 integration: accepted launch contract and composition snapshots retained; eight pinned compositions unchanged; product engine activation unchanged" });
    table.descriptors[source] = stored;
  };
  for (const commit of [main, composition]) {
    // After the initial integration, the accepted source is in the frozen
    // archive. Regeneration must also work in clones lacking old Git objects.
    const useFrozen = commit === composition && loadTransitions(repositoryRoot).table.descriptors[acceptedComposition] !== undefined;
    const sourceTable: TransitionTable = useFrozen ? loadTransitions(repositoryRoot).table : json(commit, folder + "executionTransitions.json");
    const frozen: History = useFrozen ? loadTransitions(repositoryRoot).history() : (() => {
      const pin = json(commit, folder + "transitionPin.json"), archive = gitBytes(commit, archivePath);
      const text = lf(gitBytes(commit, folder + "executionTransitions.json").toString());
      if (digest(sourceTable) !== pin.digest || sha256(text) !== pin.bytes || sha256(archive.toString("base64")) !== pin.history) throw Error(`Invalid accepted transition pins: ${commit}`);
      return JSON.parse(gunzipSync(archive).toString());
    })();
    for (const [hash, text] of Object.entries(frozen.blobs)) {
      if (sha256(text) !== hash || history.blobs[hash] !== undefined && history.blobs[hash] !== text) throw Error("Historical blob conflict");
      history.blobs[hash] = text;
    }
    for (const [key, tree] of Object.entries(frozen.trees)) {
      if (history.trees[key] && digest(history.trees[key]) !== digest(tree)) throw Error(`Historical tree conflict: ${key}`);
      history.trees[key] = tree;
    }
    for (const [key, descriptor] of Object.entries(sourceTable.descriptors)) {
      if (digest(descriptor) !== key || table.descriptors[key] && digest(table.descriptors[key]) !== key) throw Error("Historical descriptor conflict");
      table.descriptors[key] = descriptor;
    }
    for (const row of sourceTable.entries) {
      const existing = table.entries.find(entry => entry.source === row.source && entry.commit === row.commit);
      if (existing && digest({ ...existing, target: "", review: "" }) !== digest({ ...row, target: "", review: "" })) throw Error(`Historical mapping conflict: ${row.source}`);
      if (existing && existing.review !== row.review) existing.review = [...new Set([...existing.review.split("; "), ...row.review.split("; ")])].join("; ");
      if (!existing) table.entries.push(row);
    }
    retain(commit, sourceTable, commit === composition ? acceptedComposition : sourceTable.entries[0]!.target);
  }
  table.descriptors[target] = current;
  for (const row of table.entries) row.target = target;
  for (const key of Object.keys(table.descriptors)) if (key !== target && !table.entries.some(row => row.descriptor === key)) delete table.descriptors[key];
  writeTransitionStore(repositoryRoot, table, history);
  console.info(JSON.stringify({ entries: table.entries.length, current: target, pinnedCompositions: expected.length }));
}
