import { historicalIsolationDescriptor } from "./historical-isolation-descriptor";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { diskTree, executionDescriptor, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import { digest, lf, sourceHash } from "../apps/backend/executionIdentity/hash";
import { loadTransitions } from "../apps/backend/executionIdentity/transitions";
import { historicalAnalysisDescriptor } from "./historical-analysis-descriptor";
import { gitTree } from "./execution-identity";
import { writeTransitionStore } from "./transition-store";

// This command records an explicit review; it never grants syntax capabilities.
// Source needing new permissions must pass its separate exact-source review first.
function run(args: string[], cwd = repositoryRoot) {
  console.info(`bun --no-env-file ${args.join(" ")}`);
  execFileSync(process.execPath, ["--no-env-file", ...args], { cwd, stdio: "inherit" });
}
export function refreshLoadingReview() {
  const folder = "apps/backend/executionIdentity/", path = resolve(repositoryRoot, folder + "capabilityReviews.json");
  const reviews = JSON.parse(readFileSync(path, "utf8")), file = folder + "loading.ts";
  // Only the generated analysisPin may have changed since the existing review.
  const text = lf(readFileSync(resolve(repositoryRoot, file), "utf8"));
  const old = lf(execFileSync("git", ["show", `HEAD:${file}`], { cwd: repositoryRoot, encoding: "utf8" }));
  const strip = (value: string) => value.replace(/const analysisPin = "[a-f0-9]{64}";/, 'const analysisPin = "generated";');
  if (strip(old) !== strip(text)) throw Error("Loading policy changes require separate review");
  const hash = sourceHash(text); reviews[file].hash = hash;
  if (reviews[file].globals) reviews[file].globals.hash = hash;
  writeFileSync(path, JSON.stringify(reviews, null, 2) + "\n");
}

export function refreshTransitions(baseline: string, review: string) {
  if (!/^[a-f0-9]{40}$/.test(baseline) || !review.trim()) throw Error("Full baseline commit and explicit review required");
  const store = loadTransitions(repositoryRoot), { table } = store, history = store.history();
  const targets = [...new Set(table.entries.map(row => row.target))];
  if (targets.length !== 1) throw Error("Conflicting current transition targets");
  const previousTarget = targets[0]!, pending = table.entries.find(row => row.commit === baseline);
  let source = previousTarget;
  const descriptor = executionDescriptor(), target = digest(descriptor);
  if (previousTarget !== target) {
    if (pending) {
      const committed = JSON.parse(execFileSync("git", ["show", "HEAD:apps/backend/executionIdentity/executionTransitions.json"], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
      if (committed.entries.some((row: { commit: string }) => row.commit === baseline)) throw Error("Use a new baseline after committing a transition");
      source = pending.source;
    }
    const stored = table.descriptors[source]!, current = diskTree(), before = gitTree(baseline);
    const paths = [...new Set([...(stored.files as [string, string][]).map(([path]) => path), "package.json", "bun.lock", "bunfig.toml",
      ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(path => path + "/package.json")])].sort();
    const files = new Map(stored.files as [string, string][]);
    const texts = new Map(paths.map(path => {
      const text = before.paths.includes(path) ? before.read(path) : path.includes("/generated/") ? current.read(path) : undefined;
      if (text === undefined || files.has(path) && sourceHash(text) !== files.get(path)) throw Error(`Cannot retain baseline source: ${path}`);
      return [path, text];
    }));
    const retained = { paths, read: (path: string) => { const text = texts.get(path); if (text === undefined) throw Error(`Missing baseline source: ${path}`); return text; } };
    const algorithm = [
      { id: "analysis-boundary/1" as const, reconstruct: historicalAnalysisDescriptor },
      { id: "isolation-boundary/1" as const, reconstruct: historicalIsolationDescriptor },
    ].find(row => digest(row.reconstruct(retained, stored.runtime)) === source)?.id;
    if (!algorithm) throw Error("Baseline descriptor does not reconstruct");
    if (pending && pending.algorithm !== algorithm) throw Error("Conflicting baseline reconstruction algorithm");
    const snapshot = Object.fromEntries([...texts].map(([path, text]) => { const hash = sourceHash(text); history.blobs[hash] = text; return [path, hash]; }));
    if (history.trees[baseline] && digest(history.trees[baseline]) !== digest(snapshot)) throw Error("Conflicting baseline snapshot");
    history.trees[baseline] = snapshot;
    if (pending) pending.review = review;
    else table.entries.push({ commit: baseline, source, descriptor: source, target, kind: "descriptor", algorithm, review });
    table.descriptors[target] = descriptor;
    for (const row of table.entries) row.target = target;
    for (const key of Object.keys(table.descriptors)) if (key !== target && !table.entries.some(row => row.descriptor === key)) delete table.descriptors[key];
  }
  const result = writeTransitionStore(repositoryRoot, table, history), next = loadTransitions(repositoryRoot);
  const added = [...next.pack.nodes.keys()].filter(hash => !store.pack.nodes.has(hash));
  if (!pending && [...store.pack.nodes.keys()].some(hash => !next.pack.nodes.has(hash))) throw Error("Historical Merkle nodes removed");
  console.info(JSON.stringify({ entries: table.entries.length, previous: source, current: target, addedNodes: added.length, ...result }));
}

if (import.meta.main) {
  const argument = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const baseline = argument("baseline"), review = argument("review");
  if (!baseline || !review) throw Error('Use --baseline=<full pre-change commit> --review="<reviewed change and compatibility evidence>"');
  if (process.argv.includes("--transitions-only")) refreshTransitions(baseline, review);
  else {
    run(["run", "db:generate"], resolve(repositoryRoot, "apps/backend"));
    run(["scripts/execution-capabilities.ts", "--review-imports"]);
    run(["scripts/execution-identity.ts", "--build-analysis"]); refreshLoadingReview();
    run(["scripts/execution-capabilities.ts", "--review-imports"]);
    run(["scripts/execution-resolution.ts", "--build-contract"]);
    run(["scripts/execution-identity.ts", "--build-analysis"]); refreshLoadingReview();
    run(["scripts/execution-capabilities.ts", "--review-imports"]);
    run(["scripts/connected-lineage.ts"]);
    run(["scripts/m2m-lineage.ts", "--refresh-current"]);
    run(["scripts/lesson-endpoint-lineage.ts", "--refresh-current"]);
    // Loading analysis and its in-module pin changed in child processes above.
    // Reconstruct the transition in a fresh process, not this process's cached
    // pre-refresh loading module.
    run(["scripts/refresh-execution.ts", `--baseline=${baseline}`, `--review=${review}`, "--transitions-only"]);
    for (const script of ["launch-contract", "run-record-schema", "shipping-inventory", "inventory"]) run([`scripts/reality/${script}.ts`, "--write"]);
    run(["scripts/execution-identity.ts", "--check"]);
    run(["scripts/execution-resolution.ts"]);
  }
}
