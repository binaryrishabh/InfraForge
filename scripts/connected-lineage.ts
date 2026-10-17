import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyticsBaseline, dependencyContext, gitText, reviewAnalyticsLock, reviewAnalyticsManifest } from "./review-analytics-lock";
import { executionSourceFiles } from "../apps/backend/internalModel2/identity";
const root = resolve(import.meta.dir, ".."), baseline = "7e24ac77a868c9cec9e76141d29a156115238e91";
const lf = (s: string) => s.replaceAll("\r\n", "\n"), sha = (s: string) => createHash("sha256").update(lf(s)).digest("hex");
const engine = ["packages/simulation/src/model2", "packages/simulation/src/reality", "packages/domain/src", "packages/catalog/src"];
const watched = [...engine, "packages/simulation/tests", "scripts/reality", "scripts/tests", "apps/backend/internalModel2"];
const extra = ["packages/simulation/src/internalProduct.ts", "bun.lock", "apps/backend/zod_schemas/layout.schema.ts", "apps/backend/zod_schemas/deployment.schema.ts", "docs/reality/m2j-source-lineage.json", "docs/reality/m2i-ec2-source.json", "docs/reality/m2i-source-reviews.json", "docs/reality/m2i-heldout-billing.json"];
const selected = (p: string) => extra.includes(p) || watched.some(f => p.startsWith(f + "/") && p.endsWith(".ts"));
const execSelected = (p: string) => ["packages/simulation/src/internalProduct.ts", "bun.lock", "apps/backend/zod_schemas/layout.schema.ts", "apps/backend/zod_schemas/deployment.schema.ts", ...["identity", "envelope", "budgets", "capture"].map(v => `apps/backend/internalModel2/${v}.ts`)].includes(p) || engine.some(f => p.startsWith(f + "/") && p.endsWith(".ts"));
const originalPaths = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(selected).sort();
const originals = originalPaths.map(path => {
  const text = lf(execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 4194304 }));
  return { path, hash: sha(text), ...(text !== lf(readFileSync(resolve(root, path), "utf8")) ? { text } : {}) };
});
const paths: string[] = [];
const walk = (folder: string) => { for (const e of readdirSync(resolve(root, folder), { withFileTypes: true })) { const p = `${folder}/${e.name}`; if (e.isDirectory()) walk(p); else if (p.endsWith(".ts")) paths.push(p); } };
watched.forEach(walk); paths.push(...extra);
const value = { schema: "infraforge-connected-v1-lineage/1", baseline, source: "bac35c995b5e5d59a9ce901745c014644fdb843183adbcbb761fb99184c11306", runtime: "bun-1.3.14", original: originals, current: [...new Set(paths)].sort().map(path => ({ path, hash: sha(readFileSync(resolve(root, path), "utf8")) })), execution: originalPaths.filter(execSelected) };
const destination = resolve(root, "apps/backend/internalModel2/legacyRuntime.json");
let reviewedExecution = JSON.parse(readFileSync(destination, "utf8")).reviewedExecution;
const reviewSupervision = process.argv.includes("--review-supervision");
if (process.argv.includes("--review-analytics") || reviewSupervision) {
  console.info(JSON.stringify(reviewAnalyticsLock(gitText("bun.lock"), lf(readFileSync(resolve(root, "bun.lock"), "utf8")))));
  const priorPaths = execFileSync("git", ["ls-tree", "-r", "--name-only", analyticsBaseline], { cwd: root, encoding: "utf8" }).trim().split("\n")
    .filter(p => execSelected(p) || p.startsWith("apps/backend/internalModel2/") && (p.endsWith(".ts") && !p.endsWith("/sandboxChild.ts") || p.endsWith("/legacyRuntime.json"))).sort();
  if (executionSourceFiles().join("\n") !== priorPaths.join("\n")) throw Error("Unreviewed execution inventory change");
  const allowed = new Set(["bun.lock", "apps/backend/internalModel2/legacyRuntime.json", ...["identity", "legacyCompatibility", "envelopeV2", "report"].map(p => `apps/backend/internalModel2/${p}.ts`)]);
  // This review changes client supervision only; it does not change modeled execution.
  if (reviewSupervision) for (const file of ["dockerConnection", "sandboxRunner"]) allowed.add(`apps/backend/internalModel2/${file}.ts`);
  const original = priorPaths.map(path => {
    const text = gitText(path), changed = text !== lf(readFileSync(resolve(root, path), "utf8"));
    if (changed && !allowed.has(path)) throw Error(`Not a compatibility-only transition: ${path}`);
    return { path, hash: sha(text), ...(changed || path.endsWith("/legacyRuntime.json") ? { text } : {}) };
  });
  const context = dependencyContext.map(path => {
    const prior = gitText(path), current = lf(readFileSync(resolve(root, path), "utf8"));
    if (path === "apps/web/package.json") reviewAnalyticsManifest(prior, current);
    else if (prior !== current) throw Error(`Dependency/install context changed: ${path}`);
    return { path, hash: sha(current) };
  });
  reviewedExecution = { baseline: analyticsBaseline, source: "c978627d82007fc5e55f4bc653ea9132b3f185e381ac0d048afda1645d319ca6", original, context, inventory: executionSourceFiles() };
}
writeFileSync(destination, JSON.stringify({ ...value, ...(reviewedExecution ? { reviewedExecution } : {}) }, null, 2) + "\n");
console.info(JSON.stringify({ originalFiles: value.original.length, reviewedFiles: value.current.length, frozenChanged: value.original.filter(v => v.text).length }));
