import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sourceHash } from "../apps/backend/executionIdentity/hash";

const root = resolve(import.meta.dir, ".."), baseline = "f945fa521f0c8f548edb2feb2c3928d8eacd2253";
const originalHashes: Record<string, string> = {
  "packages/simulation/src/model2/compute/contracts.ts": "12d2fc95201344d72724172fde1f7362d453676f082bdb8d538c423c80485ec8",
  "packages/simulation/src/model2/compute/resource.ts": "5bd17b10f89b28b2fe44e5b5e51f78757d7c69626f3d9884ae822a25959164eb",
  "packages/simulation/src/model2/compute/validate.ts": "250efb37a885df20a5c5717d8c2b693de07f3a9435a63ce23927e5a91a873112",
  "packages/simulation/src/model2/data/aside.ts": "0c0376662639ae5d148ee717417c6af26def45ef317fa75d4b31ed82a1a12d11",
  "packages/simulation/src/model2/data/contracts.ts": "bcf44a048f028d99554a82a344a5535ab182a803645bd143e146a6f42d727f26",
  "packages/simulation/src/model2/network/validate.ts": "2155439db5b88fd6d18ab2d54bbddff1b2c9ec50a02422a8a0f30d07427fc3df",
};
export const cacheMechanismPaths = Object.keys(originalHashes).sort();
const path = resolve(root, "docs/reality/first-stack-cache-source-review.json");
interface Review { schema: string; baseline: string; files: Array<{ path: string; originalText: string; originalHash: string; currentHash: string }>; acceptance: Array<{ path: string; hash: string }> }
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
export function cacheBaselineSource(path: string, current: string): string {
  if (!cacheMechanismPaths.includes(path)) return current;
  const review = JSON.parse(readFileSync(resolve(root, "docs/reality/first-stack-cache-source-review.json"), "utf8")) as Review;
  if (review.schema !== "first-stack-cache-source-review/1" || review.baseline !== baseline || JSON.stringify(review.files.map(f => f.path)) !== JSON.stringify(cacheMechanismPaths)) throw Error("Invalid cache mechanism review scope");
  const f = review.files.find(f => f.path === path)!;
  if (f.originalHash !== originalHashes[path] || sourceHash(f.originalText) !== f.originalHash || sourceHash(current) !== f.currentHash) throw Error(`Unreviewed cache mechanism drift: ${path}`);
  return f.originalText;
}
export function verifyCacheReview() {
  const review = JSON.parse(readFileSync(path, "utf8")) as Review;
  for (const p of cacheMechanismPaths) cacheBaselineSource(p, read(p));
  for (const f of review.acceptance) if (sourceHash(read(f.path)) !== f.hash) throw Error(`Cache acceptance drift: ${f.path}`);
}
export function writeCacheReview() {
  const files = cacheMechanismPaths.map(path => {
    const originalText = execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8" }).replaceAll("\r\n", "\n");
    if (sourceHash(originalText) !== originalHashes[path]) throw Error("Unexpected cache baseline");
    return { path, originalText, originalHash: sourceHash(originalText), currentHash: sourceHash(read(path)) };
  });
  const acceptance = ["scripts/tests/first-stack-cache.test.ts", "scripts/fixtures/first-stack-cache.ts", "scripts/reality/first-stack-cache-proof.ts", "docs/reality/first-stack-cache-proof.json", "scripts/tests/g7Pilot.test.ts"].map(path => ({ path, hash: sourceHash(read(path)) }));
  writeFileSync(path, JSON.stringify({ schema: "first-stack-cache-source-review/1", baseline,
    scope: "Opt-in V3 recorded cache composition; explicit compute operation dependencies, strict-key policy and stale-fill generation separation. Existing eight replay hashes preserved; no IO/fault/retry mechanism changes, activation or timing promotion.", files, acceptance }, null, 2) + "\n");
  verifyCacheReview();
}
if (import.meta.main) { if (process.argv.includes("--write")) writeCacheReview(); verifyCacheReview(); console.log(JSON.stringify({ reviewedCacheMechanisms: cacheMechanismPaths.length })); }
