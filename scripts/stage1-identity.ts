import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { diskTree, executionDescriptor, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import type { SourceTree } from "../apps/backend/executionIdentity/descriptor";
import { digest, sha256 } from "../apps/backend/executionIdentity/hash";
import { loadTransitions } from "../apps/backend/executionIdentity/transitions";
import type { TransitionTable } from "../apps/backend/executionIdentity/transitions";
import { historicalAnalysisDescriptor } from "./historical-analysis-descriptor";
import { compositionProofs } from "./reality/composition-proofs";
import { gitTree } from "./execution-identity";
import { execFileSync } from "node:child_process";
const folder = resolve(repositoryRoot, "apps/backend/executionIdentity"), fixture = resolve(repositoryRoot, "scripts/fixtures/execution-identity-history.json.gz");
const git = (args: string[]) => execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).replaceAll("\r\n", "\n");
type History = { blobs: Record<string,string>; trees: Record<string,Record<string,string>> };
export function buildCompositionTransitions() {
  const selected = process.argv.find(arg => arg.startsWith("--composition-baseline="))?.split("=")[1] ?? "3837b94";
  if (!/^[a-f0-9]{7,40}$/.test(selected)) throw Error("Explicit local composition baseline required");
  const baselineCommit = git(["rev-parse", selected]).trim(), baseline = gitTree(baselineCommit);
  const { table, pin } = loadTransitions(repositoryRoot);
  const committed: TransitionTable = JSON.parse(git(["show", `${baselineCommit}:apps/backend/executionIdentity/executionTransitions.json`]));
  const previous = committed.entries[0]!.target, prior = committed.descriptors[previous]!;
  if (digest(prior) !== previous) throw Error("Invalid committed composition baseline");
  const current = executionDescriptor(), target = digest(current);
  const expected = JSON.parse(readFileSync(resolve(repositoryRoot, "docs/reality/stage1-composition-hashes.json"), "utf8"));
  if (JSON.stringify(compositionProofs()) !== JSON.stringify(expected)) throw Error("Pinned composition replay changed");
  const generated = new Set(["apps/backend/executionIdentity/loading.ts", "apps/backend/executionIdentity/capabilityReviews.json", "apps/backend/executionIdentity/capabilityImportReviews.json", "apps/backend/executionIdentity/analysisContract.json", "apps/backend/executionIdentity/resolutionContract.json", "apps/backend/executionIdentity/transitions.ts"]);
  const priorFiles = new Map(prior.files as [string, string][]);
  for (const [path, hash] of current.files as [string, string][]) {
    if (path.startsWith("packages/simulation/src/model2/") || generated.has(path)) continue;
    if (priorFiles.get(path) !== hash) throw Error(`Outside composition transition scope: ${path}`);
  }
  for (const [path] of priorFiles) if (!(current.files as [string, string][]).some(([file]) => file === path)) throw Error(`Removed execution source: ${path}`);
  const priorTree: SourceTree = { paths: [...new Set([...baseline.paths, ...priorFiles.keys()])], read: path => {
    if (baseline.paths.includes(path)) return baseline.read(path);
    const text = diskTree().read(path);
    if (!path.includes("/generated/") || sha256(text) !== priorFiles.get(path)) throw Error(`Missing baseline output: ${path}`);
    return text;
  } };
  if (digest(historicalAnalysisDescriptor(priorTree, "bun-1.3.14")) !== previous) throw Error("Composition baseline does not reconstruct");
  const archive = readFileSync(fixture);
  if (sha256(archive.toString("base64")) !== pin.history) throw Error("Historical snapshots changed");
  const history: History = JSON.parse(gunzipSync(archive).toString());
  if (!table.entries.some(row => row.source === previous)) {
    const paths = [...new Set([...priorFiles.keys(), "package.json", "bun.lock", "bunfig.toml", ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(path => `${path}/package.json`)])];
    history.trees[baselineCommit] = Object.fromEntries(paths.map(path => { const text = priorTree.read(path), hash = sha256(text); history.blobs[hash] = text; return [path, hash]; }));
    table.entries.push({ commit: baselineCommit, source: previous, descriptor: previous, target, kind: "descriptor", algorithm: "analysis-boundary/1", review: "Stage 1 module registry and opt-in ownership; eight m2b–m2h baseline fixture evidence hashes identical; existing named compositions and product activation unchanged" });
  }
  table.descriptors[target] = current;
  for (const row of table.entries) row.target = target;
  for (const key of Object.keys(table.descriptors)) if (key !== target && !table.entries.some(row => row.descriptor === key)) delete table.descriptors[key];
  const text = JSON.stringify(table, null, 2) + "\n", updated = gzipSync(JSON.stringify(history), { level: 9 });
  writeFileSync(resolve(folder, "executionTransitions.json"), text); writeFileSync(fixture, updated);
  writeFileSync(resolve(folder, "transitionPin.json"), JSON.stringify({ digest: digest(table), bytes: sha256(text), history: sha256(updated.toString("base64")) }, null, 2) + "\n");
  console.info(JSON.stringify({ entries: table.entries.length, previous, current: target, pinnedCompositions: expected.length }));
}
