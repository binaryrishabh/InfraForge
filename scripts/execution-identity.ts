import { withHistoricalAnalysisCache } from "./historical-analysis-cache";
import { assertHistoricalPreservation } from "./history-preservation";
import { historicalIsolationDescriptor } from "./historical-isolation-descriptor";
import { historicalDeclaredHostDescriptor } from "./historical-declared-host-descriptor";
import { reviewHardeningSyntax, refreshHardeningTransitions, refreshHardeningAcceptance } from "./hardening-identity";
import { buildCompositionTransitions } from "./stage1-identity";
import { refreshPostgresAcceptance, reviewPostgresSessions, reviewPostgresSyntax, refreshPostgresTransitions } from "./postgres-session-identity";
import { reviewStage2Modules, writeStage2ReviewLock, buildStage2Transitions } from "./stage2-authoring";
import { writeFiniteIoReview, reviewFiniteIoSyntax, reviewFiniteIoImports, refreshFiniteIoTransitions } from "./finite-io-identity";
import { reviewStage0Syntax, refreshStage0Transitions } from "./stage0-identity";
import { historicalAnalysisDescriptor } from "./historical-analysis-descriptor";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { diskTree, executionDescriptor, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import type { SourceTree } from "../apps/backend/executionIdentity/descriptor";
import { digest, lf, sha256 } from "../apps/backend/executionIdentity/hash";
import { wholeLockIdentity } from "../apps/backend/executionIdentity/legacy";
import { loadTransitions } from "../apps/backend/executionIdentity/transitions";
import { writeTransitionStore } from "./transition-store";
import { historicalLaunchDescriptor } from "./historical-launch-descriptor";
import { historicalImportDescriptor } from "./historical-import-descriptor";
import { historicalHostDescriptor } from "./historical-host-descriptor";
import { verifiedHistoricalDescriptor } from "./historical-verified-descriptor";
import { historicalDescriptor } from "./historical-execution-descriptor";
import type { TransitionTable } from "../apps/backend/executionIdentity/transitions";
import { verifyInstalled } from "../apps/backend/executionIdentity/installed";
import { executable, verifyModuleLoading, withFullLoadingAnalysis, loadingPolicyFingerprint, readLoadingAnalysis } from "../apps/backend/executionIdentity/loading";
import type { AnalysisContract } from "../apps/backend/executionIdentity/loading";

export const firstCommit = "72bb3a2";
export const lastCommit = "1d4b3211f6169d1dda2b9fcab33c7b02b6705c9b";
export const priorV2Commit = "2e581a4";
const folder = resolve(repositoryRoot, "apps/backend/executionIdentity");
type History = { blobs: Record<string, string>; trees: Record<string, Record<string, string>> };
let frozenHistory: History | undefined;
export function frozenHistoryText(commit: string, path: string) {
  const history = frozenHistory ??= loadTransitions(repositoryRoot).history();
  const text = history.blobs[history.trees[commit]?.[path] ?? ""];
  if (text === undefined) throw Error(`Missing frozen source: ${commit}:${path}`);
  return text;
}
function git(args: string[]) { return lf(execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })); }
export function checkLoadingAnalysis(write = false) {
  const tree = diskTree();
  const contract = withFullLoadingAnalysis(() => {
    const descriptor = executionDescriptor(tree);
    const modules = Object.fromEntries(descriptor.files.map(([path]) => path!).filter(path => executable.test(path) && !path.startsWith("apps/backend/executionIdentity/")).sort().map(path =>
      [path, { hash: sha256(lf(tree.read(path))), requests: verifyModuleLoading(tree.read(path), path) }]));
    return { schema: "execution-loading-analysis/1", policy: loadingPolicyFingerprint(), modules } satisfies AnalysisContract;
  });
  if (write) {
    const text = JSON.stringify(contract, null, 2) + "\n", path = resolve(folder, "loading.ts"), source = diskTree().read("apps/backend/executionIdentity/loading.ts");
    writeFileSync(resolve(folder, "analysisContract.json"), text);
    writeFileSync(path, source.replace(/const analysisPin = "[a-f0-9]{64}";/, `const analysisPin = "${sha256(text)}";`));
  } else if (JSON.stringify(contract) !== JSON.stringify(readLoadingAnalysis())) throw Error("Reviewed loading analysis changed");
  return { analysedModules: Object.keys(contract.modules).length };
}
export function gitTree(commit: string): SourceTree {
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
  const { table, history: readHistory } = loadTransitions(repositoryRoot);
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
  const history = readHistory();
  const paths = [...new Set([...prior.files.map(([path]) => path!), "package.json", "bun.lock", "bunfig.toml", ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(path => `${path}/package.json`)])];
  history.trees[commit] = Object.fromEntries(paths.map(path => { const text = baseline.read(path), hash = sha256(text); history.blobs[hash] = text; return [path, hash]; }));
  const committedTable = JSON.parse(git(["show", "HEAD:apps/backend/executionIdentity/executionTransitions.json"])) as TransitionTable;
  const previousTarget = committedTable.entries[0]!.target;
  if (previousTarget !== source && previousTarget !== target && !table.entries.some(row => row.source === previousTarget)) {
    const reviewedHosts: Record<string,string> = { "fe8fd0f18c15de1e762ebbdfd3474f1a35a56d4f46acca85db90221ed8fb21a7": "20af730", "26b81b300de225a6a27d512eb696ad448502d11a073817b9ad203bb1c531f90f": "23203fa", "3886e64e2954e8513647ece8fa126af4dcad33cf2c63ad1eed89b15edca969c1": "53188f7", "421000e5a4f5be3dd3c1464f4a9fd44ea75f7236bb6222a5410e5f89f0aa381d": "c1edd9f", "f4890c845828de4f5280bff19cb35851a7241a8129bde4e233956f65bdd94219": "4c92f13" };
    // Global-name boundary tightening only; preserve the last committed target
    // with the existing frozen host/import/launch reconstruction algorithm.
    reviewedHosts["b04389078881cb89124edd1191c049b9c5abb0d17f18472857cf9310a03262e6"] = "f8e7c33";
    reviewedHosts["435856da26ac9b492b5a52a7b777ade046326ba7a3533a59450f16e148c410e1"] = "91654e8";
    reviewedHosts["9ccb50238354fe57acf551042b399677c0cd606df2c3f22bf1c1b94f02a87b3d"] = "fb4f336";
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
    const launchBoundary = ["f4890c845828de4f5280bff19cb35851a7241a8129bde4e233956f65bdd94219", "b04389078881cb89124edd1191c049b9c5abb0d17f18472857cf9310a03262e6", "435856da26ac9b492b5a52a7b777ade046326ba7a3533a59450f16e148c410e1", "9ccb50238354fe57acf551042b399677c0cd606df2c3f22bf1c1b94f02a87b3d"].includes(previousTarget);
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
  writeTransitionStore(repositoryRoot, table, history);
  console.info(JSON.stringify({ entries: table.entries.length, previous: source, current: target }));
}

export function checkTransitions(root = repositoryRoot, read?: (path: string) => string | Buffer) {
  return withHistoricalAnalysisCache(() => reconstructTransitions(root, read));
}
function reconstructTransitions(root: string, read?: (path: string) => string | Buffer) {
  const { table, mappings: mapping, history: readHistory } = loadTransitions(root, read);
  const history = readHistory();
  assertHistoricalPreservation(table, history, root);
  if (digest(Object.keys(history.trees).sort()) !== digest(table.entries.map(row => row.commit).sort())) throw Error("Historical transition coverage changed");
  for (const [hash, text] of Object.entries(history.blobs)) if (sha256(text) !== hash) throw Error("Historical execution text changed");
  const reconstructed = new Map<string, string>();
  for (const row of table.entries) {
    const files = history.trees[row.commit]!;
    const tree: SourceTree = { paths: Object.keys(files), read: path => {
      const text = history.blobs[files[path]!]; if (text === undefined) throw Error(`Missing snapshot source: ${path}`); return text;
    } };
    const algorithm = row.algorithm ?? (row.commit.startsWith("2da5b74") ? "verified/1" : "original/1");
    const key = digest([algorithm, table.descriptors[row.descriptor]!.runtime, files]);
    let rebuilt = reconstructed.get(key);
    if (rebuilt === undefined) {
      rebuilt = digest((row.algorithm === "declared-host-boundary/1" ? historicalDeclaredHostDescriptor : row.algorithm === "isolation-boundary/1" ? historicalIsolationDescriptor : row.algorithm === "analysis-boundary/1" ? historicalAnalysisDescriptor : row.algorithm === "launch-boundary/1" ? historicalLaunchDescriptor : row.algorithm === "import-boundary/1" ? historicalImportDescriptor : row.algorithm === "host-boundary/1" ? historicalHostDescriptor : row.commit.startsWith("2da5b74") ? verifiedHistoricalDescriptor : historicalDescriptor)(tree, table.descriptors[row.descriptor]!.runtime));
      // Memoize only after the complete reconstruction matches its authenticated descriptor.
      if (rebuilt !== row.descriptor) throw Error("Historical closure does not reconstruct");
      reconstructed.set(key, rebuilt);
    }
    if (rebuilt !== row.descriptor) throw Error("Historical closure does not reconstruct");
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
  if (process.argv.includes("--write-io-review")) { writeFiniteIoReview(); console.info("Finite IO source review written"); }
  else if (process.argv.includes("--review-io-syntax")) reviewFiniteIoSyntax();
  else if (process.argv.includes("--review-io-imports")) reviewFiniteIoImports();
  else if (process.argv.includes("--refresh-io-transitions")) refreshFiniteIoTransitions();
  else if (process.argv.includes("--review-hardening-syntax")) reviewHardeningSyntax();
  else if (process.argv.includes("--review-hardening-acceptance")) refreshHardeningAcceptance();
  else if (process.argv.includes("--review-hardening-transitions")) refreshHardeningTransitions();
  else if (process.argv.includes("--review-pg-acceptance")) refreshPostgresAcceptance();
  else if (process.argv.includes("--write-pg-review")) reviewPostgresSessions();
  else if (process.argv.includes("--review-pg-syntax")) reviewPostgresSyntax();
  else if (process.argv.includes("--refresh-pg-transitions")) refreshPostgresTransitions();
  else if (process.argv.includes("--review-stage2-modules")) reviewStage2Modules();
  else if (process.argv.includes("--write-stage2-review-lock")) writeStage2ReviewLock();
  else if (process.argv.includes("--build-stage2-transitions")) buildStage2Transitions();
  else if (process.argv.includes("--review-stage0-syntax")) reviewStage0Syntax();
  else if (process.argv.includes("--review-stage0-transitions")) refreshStage0Transitions();
  else if (process.argv.includes("--build-analysis")) console.info(JSON.stringify(checkLoadingAnalysis(true)));
  else if (process.argv.includes("--build-composition-transitions")) buildCompositionTransitions();
  else if (process.argv.includes("--build-transitions")) buildTransitions();
  else if (process.argv.includes("--check")) console.info(JSON.stringify({ ...checkLoadingAnalysis(), ...checkTransitions() }));
  else console.info(digest(executionDescriptor(diskTree())));
}
