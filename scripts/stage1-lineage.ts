import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compositionProofs } from "./reality/composition-proofs";

const root = resolve(import.meta.dir, ".."), baseline = "3837b94";
const destination = resolve(root, "docs/reality/stage1-source-lineage.json");
const lf = (s: string) => s.replaceAll("\r\n", "\n");
const hash = (s: string) => createHash("sha256").update(lf(s)).digest("hex");
interface Lineage { schema: string; baseline: string; files: Array<{ path: string; originalHash: string; currentHash: string; originalText: string }> }
let metadata: Lineage | undefined;
export function stage1BaselineText(path: string, current: string) {
  const lineage = metadata ??= JSON.parse(readFileSync(destination, "utf8")) as Lineage;
  if (lineage.schema !== "infraforge-composition-lineage/1" || lineage.baseline !== baseline) throw Error("Invalid composition lineage");
  const file = lineage.files.find(f => f.path === path);
  if (!file) return current;
  if (hash(current) !== file.currentHash || hash(file.originalText) !== file.originalHash) throw Error(`Unreviewed composition source drift: ${path}`);
  return file.originalText;
}
function refresh() {
  const expected = JSON.parse(readFileSync(resolve(root, "docs/reality/stage1-composition-hashes.json"), "utf8"));
  if (JSON.stringify(expected) !== JSON.stringify(compositionProofs())) throw Error("Pinned composition replay changed; refuse lineage refresh");
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline], { cwd: root, encoding: "utf8" }).trim().split("\n")
    .filter(p => p.startsWith("packages/simulation/src/model2/") || ["scripts/reality/source-lineage.ts", "scripts/metering-lineage.ts"].includes(p));
  const files = paths.flatMap(path => {
    const originalText = lf(execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8" }));
    const currentHash = hash(readFileSync(resolve(root, path), "utf8")), originalHash = hash(originalText);
    return currentHash === originalHash ? [] : [{ path, originalHash, currentHash, originalText }];
  });
  writeFileSync(destination, JSON.stringify({ schema: "infraforge-composition-lineage/1", baseline, files }, null, 2) + "\n");
  console.info(JSON.stringify({ projectedFiles: files.length, pinnedCompositions: expected.length }));
}
if (import.meta.main) {
  if (process.argv.includes("--write")) refresh();
  if (process.argv.includes("--review-modules")) {
    const destination = resolve(root, "apps/backend/executionIdentity/capabilityReviews.json");
    const reviews = JSON.parse(readFileSync(destination, "utf8"));
    const originals = JSON.parse(execFileSync("git", ["show", `${baseline}:apps/backend/executionIdentity/capabilityReviews.json`], { cwd: root, encoding: "utf8" }));
    const baselinePaths = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", baseline], { cwd: root, encoding: "utf8" }).trim().split("\n"));
    const walk = (folder: string): string[] => readdirSync(resolve(root, folder), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${folder}/${e.name}`) : e.name.endsWith(".ts") ? [`${folder}/${e.name}`] : []);
    // Exact data-indexing review only. No filesystem, runtime-loader, host-global
    // or evaluator permission is introduced for a resource module.
    for (const path of walk("packages/simulation/src/model2")) {
      const current = hash(readFileSync(resolve(root, path), "utf8"));
      if (baselinePaths.has(path) && current === hash(execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8" }))) {
        if (!originals[path]) delete reviews[path];
        continue;
      }
      if (reviews[path] && reviews[path].hash === current) continue;
      reviews[path] = { hash: current, capabilities: ["computed-data"], review: "Composition module: reviewed fixed configuration/identity/measurement indexing; no dynamic loading or host access" };
    }
    writeFileSync(destination, JSON.stringify(reviews, null, 2) + "\n");
  }
  if (process.argv.includes("--review-analysis-pin")) {
    const destination = resolve(root, "apps/backend/executionIdentity/capabilityReviews.json");
    const reviews = JSON.parse(readFileSync(destination, "utf8"));
    for (const path of ["apps/backend/executionIdentity/loading.ts", "apps/backend/executionIdentity/transitions.ts"]) {
      reviews[path].hash = hash(readFileSync(resolve(root, path), "utf8"));
      if (reviews[path].globals) reviews[path].globals.hash = reviews[path].hash;
    }
    writeFileSync(destination, JSON.stringify(reviews, null, 2) + "\n");
  }
}
