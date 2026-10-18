import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { diskTree, executionDescriptor, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import type { SourceTree } from "../apps/backend/executionIdentity/descriptor";
import { digest, lf, sha256 } from "../apps/backend/executionIdentity/hash";
import { wholeLockIdentity } from "../apps/backend/executionIdentity/legacy";
import { validateTransitions } from "../apps/backend/executionIdentity/transitions";
import type { TransitionTable } from "../apps/backend/executionIdentity/transitions";
import { verifyInstalled } from "../apps/backend/executionIdentity/installed";

export const firstCommit = "72bb3a2";
export const lastCommit = "1d4b3211f6169d1dda2b9fcab33c7b02b6705c9b";
const folder = resolve(repositoryRoot, "apps/backend/executionIdentity");
const fixture = resolve(repositoryRoot, "scripts/fixtures/execution-identity-history.json.gz");
type History = { blobs: Record<string, string>; trees: Record<string, Record<string, string>> };
let frozenHistory: History | undefined;
export function frozenHistoryText(commit: string, path: string) {
  const history = frozenHistory ??= JSON.parse(gunzipSync(readFileSync(fixture)).toString()) as History;
  const text = history.blobs[history.trees[commit]?.[path] ?? ""];
  if (text === undefined) throw Error(`Missing frozen source: ${commit}:${path}`);
  return text;
}
function git(args: string[]) { return lf(execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })); }
function gitTree(commit: string): SourceTree {
  const paths = git(["ls-tree", "-r", "--name-only", commit]).trim().split("\n").filter(path =>
    !path.split("/").some(part => part.startsWith(".") || ["tests", "generated", "node_modules"].includes(part)) &&
    (path.startsWith("apps/backend/") || path.startsWith("packages/") || ["package.json", "bun.lock", "bunfig.toml", "tsconfig.base.json", "apps/web/package.json"].includes(path)));
  const result = spawnSync("git", ["cat-file", "--batch"], { cwd: repositoryRoot, input: paths.map(path => `${commit}:${path}\n`).join(""), maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw Error("Cannot read execution history");
  const texts = new Map<string, string>(); let offset = 0;
  for (const path of paths) {
    const end = result.stdout.indexOf(10, offset), header = result.stdout.subarray(offset, end).toString();
    const size = Number(header.split(" ")[2]);
    if (!Number.isSafeInteger(size)) throw Error(`Missing historical source: ${path}`);
    texts.set(path, lf(result.stdout.subarray(end + 1, end + 1 + size).toString()));
    offset = end + 1 + size + 1;
  }
  return { paths, read: path => { const text = texts.get(path); if (text === undefined) throw Error(`Missing historical source: ${path}`); return text; } };
}

function buildTransitions() {
  const runtime = "bun-1.3.14", current = executionDescriptor(), target = digest(current);
  const first = git(["rev-parse", firstCommit]).trim();
  const commits = git(["rev-list", "--reverse", "--ancestry-path", `${first}^..${lastCommit}`]).trim().split("\n");
  if (!commits.includes(first) || !commits.includes(lastCommit)) throw Error("Incomplete connected history");
  const baseline = gitTree(lastCommit), prior = executionDescriptor(baseline, runtime);
  // This migration may change identity machinery only. Further engine changes need a new review.
  const oldFiles = new Map(prior.files as [string, string][]);
  for (const [path, hash] of current.files as [string, string][]) {
    if (path === "apps/backend/internalModel2/sandboxRunner.ts" && hash !== "23692677a70e09f45ec9c0ebdcf294ac61c57f71507b7b7b065eecc9b149db34") throw Error("Unreviewed sandbox readiness transition");
    if (path.startsWith("apps/backend/executionIdentity/") || ["identity", "legacyCompatibility", "sandboxRunner"].some(name => path === `apps/backend/internalModel2/${name}.ts`)) continue;
    if (oldFiles.get(path) !== hash) throw Error(`Not an identity-only transition: ${path}`);
  }
  for (const [path] of prior.files) if (!current.files.some(([file]) => file === path)) throw Error(`Removed execution source: ${path}`);
  if (digest(prior.dependencies) !== digest(current.dependencies) || digest(prior.settings) !== digest(current.settings)) throw Error("Execution dependencies changed during migration");
  const table: TransitionTable = { schema: "execution-source-transitions/1", first, last: lastCommit, descriptors: { [target]: current }, entries: [] };
  const history: History = { blobs: {}, trees: {} };
  function retain(commit: string, source?: string) {
    const tree = gitTree(commit), descriptor = executionDescriptor(tree, runtime), hash = digest(descriptor);
    if (digest(descriptor.dependencies) !== digest(prior.dependencies) || digest(descriptor.settings) !== digest(prior.settings)) throw Error(`Historical dependency review required: ${commit}`);
    if (!source) {
      const reviewed = new Set(["captureV1", "dockerConnection", "envelopeV2", "identity", "legacyCompatibility", "report", "sandboxRunner"].map(name => `apps/backend/internalModel2/${name}.ts`));
      reviewed.add("apps/backend/internalModel2/legacyRuntime.json");
      for (const [path, hash] of descriptor.files as [string, string][]) if (oldFiles.get(path) !== hash && !reviewed.has(path)) throw Error(`Unreviewed historical execution change: ${commit}:${path}`);
      for (const [path] of prior.files) if (!descriptor.files.some(([file]) => file === path) && !reviewed.has(path!)) throw Error(`Unreviewed historical execution addition: ${path}`);
    }
    const identitySource = tree.read("apps/backend/internalModel2/identity.ts");
    const includeSandbox = !identitySource.includes('e.name !== "sandboxChild.ts"');
    const recorded = source ?? wholeLockIdentity(tree, runtime, includeSandbox);
    table.descriptors[hash] = descriptor;
    table.entries.push({ commit, source: recorded, descriptor: hash, target,
      review: source ? "Retained v1 replay adapter and frozen legacyRuntime reconstruction" : "Connected replay adapter; identity/compatibility, capture validation and sandbox supervision revisions retained; modeled engine unchanged" });
    const files = [...new Set([...descriptor.files.map(([path]) => path!), "bun.lock", "bunfig.toml", "package.json", ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(path => `${path}/package.json`)])];
    history.trees[commit] = Object.fromEntries(files.map(path => {
      const text = tree.read(path), hash = sha256(text); history.blobs[hash] = text; return [path, hash];
    }));
  }
  for (const commit of commits) retain(commit);
  const legacy = JSON.parse(readFileSync(resolve(repositoryRoot, "apps/backend/internalModel2/legacyRuntime.json"), "utf8"));
  retain(legacy.baseline, legacy.source);
  if (!table.entries.some(row => row.source === legacy.reviewedExecution.source)) throw Error("Reviewed connected identity missing");
  const text = JSON.stringify(table, null, 2) + "\n";
  writeFileSync(resolve(folder, "executionTransitions.json"), text);
  mkdirSync(resolve(repositoryRoot, "scripts/fixtures"), { recursive: true });
  const archive = gzipSync(JSON.stringify(history), { level: 9 });
  writeFileSync(fixture, archive);
  writeFileSync(resolve(folder, "transitionPin.json"), JSON.stringify({ digest: digest(table), bytes: sha256(text), history: sha256(archive.toString("base64")) }, null, 2) + "\n");
  console.info(JSON.stringify({ commits: commits.length, entries: table.entries.length, descriptors: Object.keys(table.descriptors).length, current: target }));
}

export function checkTransitions() {
  const table = JSON.parse(readFileSync(resolve(folder, "executionTransitions.json"), "utf8")) as TransitionTable;
  const pin = JSON.parse(readFileSync(resolve(folder, "transitionPin.json"), "utf8"));
  const mapping = validateTransitions(table, pin.digest), archive = readFileSync(fixture);
  if (sha256(archive.toString("base64")) !== pin.history) throw Error("Historical execution snapshots changed");
  const history = JSON.parse(gunzipSync(archive).toString()) as History;
  if (digest(Object.keys(history.trees).sort()) !== digest(table.entries.map(row => row.commit).sort())) throw Error("Historical transition coverage changed");
  for (const [hash, text] of Object.entries(history.blobs)) if (sha256(text) !== hash) throw Error("Historical execution text changed");
  for (const row of table.entries) {
    const files = history.trees[row.commit]!;
    const tree: SourceTree = { paths: Object.keys(files), read: path => {
      const text = history.blobs[files[path]!]; if (text === undefined) throw Error(`Missing snapshot source: ${path}`); return text;
    } };
    if (digest(executionDescriptor(tree, table.descriptors[row.descriptor]!.runtime)) !== row.descriptor) throw Error("Historical closure does not reconstruct");
    let source: string;
    if (row.source.startsWith("bac35c99")) {
      const legacy = JSON.parse(readFileSync(resolve(repositoryRoot, "apps/backend/internalModel2/legacyRuntime.json"), "utf8"));
      source = digest({ runtime: legacy.runtime, files: legacy.execution.map((path: string) => [path, tree.read(path)]) });
    } else source = wholeLockIdentity(tree, table.descriptors[row.descriptor]!.runtime, !tree.read("apps/backend/internalModel2/identity.ts").includes('e.name !== "sandboxChild.ts"'));
    if (source !== row.source) throw Error(`Historical whole-lock identity does not reconstruct: ${row.commit}`);
  }
  const descriptor = executionDescriptor(), current = digest(descriptor);
  if (table.last !== lastCommit || !table.entries.some(row => row.commit === lastCommit && mapping.get(row.source) === current)) throw Error("Migration HEAD does not map to current execution");
  verifyInstalled(descriptor, repositoryRoot);
  return { schema: descriptor.schema, current, historicalEntries: table.entries.length, packages: descriptor.dependencies.packages.length };
}
if (import.meta.main) {
  if (process.argv.includes("--build-transitions")) buildTransitions();
  else if (process.argv.includes("--check")) console.info(JSON.stringify(checkTransitions()));
  else console.info(digest(executionDescriptor(diskTree())));
}
