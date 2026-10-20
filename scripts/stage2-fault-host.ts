import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { sourceHash } from "../apps/backend/executionIdentity/hash";

// Separate slice 09 review: the bounds/PG/Stage 1 baseline artifacts stay intact.
const baseline = "7a75f8b6c09353e54544feb17840dfb25019affb";
const pins: Record<string, string> = {
  "packages/simulation/src/model2/composition/run.ts": "4861bf6e7cc0046c665e01316327c582781f5e08205a77080a037a40e0685e12",
  "packages/simulation/src/model2/network/contracts.ts": "a55f006f05a61fd5214a2be8d5174f197c398f7c3eb78efdb520ecb9796a32a5",
  "packages/simulation/src/model2/network/load-balancer.ts": "baee14b77dbde52219d6464866690432e2d2021e1ebbad2e7935d9e28b1fd025",
  "packages/simulation/src/model2/network/run.ts": "6ea7acfd0a369416b9306a5d0761cefd80c547faa744bc7d41182808d9a848b6"
};
export const faultHostPaths = Object.keys(pins).sort();
const artifact = "docs/reality/first-stack-fault-host.json";
interface Review { baseline: string; files: Array<{ path: string; original: string; currentHash: string }> }
export function beforeFaultHost(path: string, current: string) {
  if (!pins[path]) return current;
  const review = JSON.parse(readFileSync(artifact, "utf8")) as Review;
  if (review.baseline !== baseline || JSON.stringify(review.files.map(f => f.path)) !== JSON.stringify(faultHostPaths)) throw Error("Invalid fault host review scope");
  const file = review.files.find(f => f.path === path)!;
  if (sourceHash(file.original) !== pins[path] || sourceHash(current) !== file.currentHash) throw Error(`Unreviewed fault host: ${path}`);
  return file.original;
}
if (import.meta.main && process.argv.includes("--write")) {
  const files = faultHostPaths.map(path => {
    const original = execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
    if (sourceHash(original) !== pins[path]) throw Error(`Unexpected pre-fault host: ${path}`);
    return { path, original, currentHash: sourceHash(readFileSync(path, "utf8")) };
  });
  writeFileSync(artifact, JSON.stringify({ schema: "first-stack-fault-host/1", baseline,
    scope: "Explicit compute process crash cleanup/generation replacement, LB health epoch invalidation and read retry allowlist. Absent scenario preserves eight historical fixture outputs. No cache, CPU competitor, forced live retirement, activation or timing promotion.", files }, null, 2) + "\n");
}
