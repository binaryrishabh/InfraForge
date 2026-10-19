import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { diskTree, executionDescriptor, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import type { SourceTree } from "../apps/backend/executionIdentity/descriptor";
import { digest, lf, sha256 } from "../apps/backend/executionIdentity/hash";
import { wholeLockIdentity } from "../apps/backend/executionIdentity/legacy";
import { loadTransitions } from "../apps/backend/executionIdentity/transitions";
import { historicalLaunchDescriptor } from "./historical-launch-descriptor";
import { historicalImportDescriptor } from "./historical-import-descriptor";
import { historicalHostDescriptor } from "./historical-host-descriptor";
import { verifiedHistoricalDescriptor } from "./historical-verified-descriptor";
import { historicalDescriptor } from "./historical-execution-descriptor";
import type { TransitionTable } from "../apps/backend/executionIdentity/transitions";
import { verifyInstalled } from "../apps/backend/executionIdentity/installed";

export const firstCommit = "72bb3a2";
export const lastCommit = "1d4b3211f6169d1dda2b9fcab33c7b02b6705c9b";
export const priorV2Commit = "2e581a4";
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
    (path === ".dockerignore" || !path.split("/").some(part => part.startsWith(".") || ["tests", "generated", "node_modules"].includes(part))) &&
    (path.startsWith("apps/backend/") || path.startsWith("packages/") || ["package.json", "bun.lock", "bunfig.toml", "tsconfig.base.json", "apps/web/package.json", ".dockerignore"].includes(path)));
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

// Explicit boundary review. Preserve every recorded descriptor and snapshot.
function buildTransitions() {
  const { table, pin } = loadTransitions(repositoryRoot);
  const commit = git(["rev-parse", "2da5b74"]).trim(), baseline = gitTree(commit);
  const prior = verifiedHistoricalDescriptor(baseline, "bun-1.3.14"), source = digest(prior);
  const current = executionDescriptor(), target = digest(current);
  const existing = table.entries.find(row => row.source === source);
  if (!table.descriptors[source] || new Set(table.entries.map(row => row.target)).size !== 1) throw Error("Unexpected boundary review baseline");
  if (digest(prior) !== digest(table.descriptors[source])) throw Error("Prior descriptor does not reconstruct");
  if (diskTree().read("bun.lock") !== baseline.read("bun.lock")) throw Error("Dependency review required");
  for (const [path, hash] of current.files as [string, string][]) {
    if (path.startsWith("apps/backend/executionIdentity/") || path.includes("/generated/")) continue;
    if (["apps/backend/Dockerfile", "apps/backend/docker-compose.yml", ".dockerignore"].includes(path)) continue;
    if (["apps/backend/utils/config.ts", "apps/backend/prisma.config.ts"].includes(path)) {
      if (diskTree().read(path).trim() !== baseline.read(path).replace(/import "dotenv\/config";?/, "").trim()) throw Error("Unexpected runtime config edit");
      continue;
    }
    if (path === "apps/backend/worker.ts") {
      const stripped = diskTree().read(path).replace('import { assertExecutionHost } from "./executionIdentity/launch";\n', "").replace("assertExecutionHost();\n", "");
      if (stripped !== baseline.read(path)) throw Error("Unexpected worker host edit");
      continue;
    }
    if (["apps/backend/internalModel2/execution.ts", "apps/backend/internalModel2/lessonExecution.ts"].includes(path)) {
      const stripped = diskTree().read(path).replace('import { assertExecutionHost } from "../executionIdentity/launch";\n', "").replaceAll("  assertExecutionHost();\n", "");
      if (stripped !== baseline.read(path)) throw Error("Unexpected host-workflow edit");
      continue;
    }
    if (!baseline.paths.includes(path) || sha256(baseline.read(path)) !== hash) throw Error(`Not a boundary-only transition: ${path}`);
  }
  const archive = readFileSync(fixture);
  if (sha256(archive.toString("base64")) !== pin.history) throw Error("Historical snapshots changed");
  const history = JSON.parse(gunzipSync(archive).toString()) as History;
  const paths = [...new Set([...prior.files.map(([path]) => path!), "package.json", "bun.lock", "bunfig.toml", ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(path => `${path}/package.json`)])];
  history.trees[commit] = Object.fromEntries(paths.map(path => { const text = baseline.read(path), hash = sha256(text); history.blobs[hash] = text; return [path, hash]; }));
  const committedTable = JSON.parse(git(["show", "HEAD:apps/backend/executionIdentity/executionTransitions.json"])) as TransitionTable;
  const previousTarget = committedTable.entries[0]!.target;
  if (previousTarget !== source && previousTarget !== target && !table.entries.some(row => row.source === previousTarget)) {
    const reviewedHosts: Record<string,string> = { "fe8fd0f18c15de1e762ebbdfd3474f1a35a56d4f46acca85db90221ed8fb21a7": "20af730", "26b81b300de225a6a27d512eb696ad448502d11a073817b9ad203bb1c531f90f": "23203fa", "3886e64e2954e8513647ece8fa126af4dcad33cf2c63ad1eed89b15edca969c1": "53188f7", "421000e5a4f5be3dd3c1464f4a9fd44ea75f7236bb6222a5410e5f89f0aa381d": "c1edd9f", "f4890c845828de4f5280bff19cb35851a7241a8129bde4e233956f65bdd94219": "4c92f13" };
    const reviewedCommit = reviewedHosts[previousTarget];
    if (!reviewedCommit) throw Error("A new committed host transition needs explicit review");
    const hostCommit = git(["rev-parse", reviewedCommit]).trim(), hostTree = gitTree(hostCommit);
    const stored = table.descriptors[previousTarget]!;
    const storedFiles = stored.files as [string, string][];
    const hostPaths = [...new Set([...hostTree.paths, ...storedFiles.map(([path]) => path)])];
    const hostSnapshot: SourceTree = { paths: hostPaths, read: path => {
      if (hostTree.paths.includes(path)) return hostTree.read(path);
      const pin = storedFiles.find(([file]) => file === path)?.[1];
      if (!path.includes("/generated/") || !pin || sha256(diskTree().read(path)) !== pin) throw Error(`Missing committed generation output: ${path}`);
      return diskTree().read(path);
    } };
    const importBoundary = ["3886e64e2954e8513647ece8fa126af4dcad33cf2c63ad1eed89b15edca969c1", "421000e5a4f5be3dd3c1464f4a9fd44ea75f7236bb6222a5410e5f89f0aa381d"].includes(previousTarget);
    const launchBoundary = previousTarget === "f4890c845828de4f5280bff19cb35851a7241a8129bde4e233956f65bdd94219";
    const frozen = (launchBoundary ? historicalLaunchDescriptor : importBoundary ? historicalImportDescriptor : historicalHostDescriptor)(hostSnapshot, "bun-1.3.14");
    if (digest(frozen) !== previousTarget) throw Error("Committed host descriptor does not reconstruct");
    const retainedPaths = [...new Set([...storedFiles.map(([path]) => path), "package.json", "bun.lock", "bunfig.toml", ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(path => `${path}/package.json`)])];
    history.trees[hostCommit] = Object.fromEntries(retainedPaths.map(path => { const text = hostSnapshot.read(path), hash = sha256(text); history.blobs[hash] = text; return [path, hash]; }));
    table.entries.push({ commit: hostCommit, source: previousTarget, descriptor: previousTarget, target, kind: "descriptor", algorithm: launchBoundary ? "launch-boundary/1" : importBoundary ? "import-boundary/1" : "host-boundary/1", review: "Committed host descriptor retained; reviewed containment/capability boundary hardening; production child, engine, schema and dependency bytes unchanged" });
  }
  table.descriptors[target] = current;
  for (const row of table.entries) {
    row.target = target;
    if (!existing) row.review += "; execution boundary review: unchanged engine/lock, host closure, generated client, selected implementations, strict capabilities and launch contract";
  }
  if (!existing) table.entries.push({ commit, source, descriptor: source, target, kind: "descriptor", review: "Preserved verified v2 descriptor; boundary-only changes reviewed against committed host/schema/lock; dotenv file discovery removed, supplied environment retained" });
  for (const key of Object.keys(table.descriptors)) if (key !== target && !table.entries.some(row => row.descriptor === key)) delete table.descriptors[key];
  const text = JSON.stringify(table, null, 2) + "\n", updatedArchive = gzipSync(JSON.stringify(history), { level: 9 });
  writeFileSync(resolve(folder, "executionTransitions.json"), text);
  writeFileSync(fixture, updatedArchive);
  writeFileSync(resolve(folder, "transitionPin.json"), JSON.stringify({ digest: digest(table), bytes: sha256(text), history: sha256(updatedArchive.toString("base64")) }, null, 2) + "\n");
  console.info(JSON.stringify({ entries: table.entries.length, previous: source, current: target }));
}

export function checkTransitions(root = repositoryRoot, read?: (path: string) => string) {
  const { table, pin, mappings: mapping } = loadTransitions(root, read), archive = readFileSync(resolve(root, "scripts/fixtures/execution-identity-history.json.gz"));
  if (sha256(archive.toString("base64")) !== pin.history) throw Error("Historical execution snapshots changed");
  const history = JSON.parse(gunzipSync(archive).toString()) as History;
  if (digest(Object.keys(history.trees).sort()) !== digest(table.entries.map(row => row.commit).sort())) throw Error("Historical transition coverage changed");
  for (const [hash, text] of Object.entries(history.blobs)) if (sha256(text) !== hash) throw Error("Historical execution text changed");
  for (const row of table.entries) {
    const files = history.trees[row.commit]!;
    const tree: SourceTree = { paths: Object.keys(files), read: path => {
      const text = history.blobs[files[path]!]; if (text === undefined) throw Error(`Missing snapshot source: ${path}`); return text;
    } };
    if (digest((row.algorithm === "launch-boundary/1" ? historicalLaunchDescriptor : row.algorithm === "import-boundary/1" ? historicalImportDescriptor : row.algorithm === "host-boundary/1" ? historicalHostDescriptor : row.commit.startsWith("2da5b74") ? verifiedHistoricalDescriptor : historicalDescriptor)(tree, table.descriptors[row.descriptor]!.runtime)) !== row.descriptor) throw Error("Historical closure does not reconstruct");
    let source: string;
    if (row.kind === "descriptor") source = row.descriptor;
    else if (row.source.startsWith("bac35c99")) {
      const legacy = JSON.parse(readFileSync(resolve(root, "apps/backend/internalModel2/legacyRuntime.json"), "utf8"));
      source = digest({ runtime: legacy.runtime, files: legacy.execution.map((path: string) => [path, tree.read(path)]) });
    } else source = wholeLockIdentity(tree, table.descriptors[row.descriptor]!.runtime, !tree.read("apps/backend/internalModel2/identity.ts").includes('e.name !== "sandboxChild.ts"'));
    if (source !== row.source) throw Error(`Historical whole-lock identity does not reconstruct: ${row.commit}`);
  }
  const descriptor = executionDescriptor(diskTree(root)), current = digest(descriptor);
  if (table.last !== lastCommit || !table.entries.some(row => row.commit === lastCommit && mapping.get(row.source) === current)) throw Error("Migration HEAD does not map to current execution");
  verifyInstalled(descriptor, root);
  return { schema: descriptor.schema, current, historicalEntries: table.entries.length, packages: descriptor.dependencies.packages.length };
}
if (import.meta.main) {
  if (process.argv.includes("--build-transitions")) buildTransitions();
  else if (process.argv.includes("--check")) console.info(JSON.stringify(checkTransitions()));
  else console.info(digest(executionDescriptor(diskTree())));
}
