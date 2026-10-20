import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { digest, sourceHash } from "../apps/backend/executionIdentity/hash";
import { loadTransitions } from "../apps/backend/executionIdentity/transitions";

// Separate slice 09 review: the bounds/PG/Stage 1 baseline artifacts stay intact.
const baseline = "ca812b96fb39c0fbb03bcfcd8d1e9b0ec80a252d";
const pins: Record<string, string> = {
  "packages/simulation/src/model2/composition/run.ts": "597fec1e7bdafdabe5f42948860a4ef4d9503c5d03a78184cb527f24286eaac7",
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
  const { table } = loadTransitions(process.cwd(), path => execFileSync("git", ["show", `${baseline}:${relative(process.cwd(), path).replaceAll("\\", "/")}`], { maxBuffer: 64 * 1024 * 1024 }));
  const source = "aab124470309d4ba3058d536203bf7d9bc60cb2352c05775bfc54d439391810e";
  const descriptor = table.descriptors[source];
  if (!descriptor || digest(descriptor) !== source) throw Error("Accepted pre-fault descriptor drift");
  writeFileSync("docs/reality/first-stack-fault-baseline.json", JSON.stringify({ commit: baseline, source, descriptor }, null, 2) + "\n");
  const files = faultHostPaths.map(path => {
    const original = execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
    if (sourceHash(original) !== pins[path]) throw Error(`Unexpected pre-fault host: ${path}`);
    return { path, original, currentHash: sourceHash(readFileSync(path, "utf8")) };
  });
  writeFileSync(artifact, JSON.stringify({ schema: "first-stack-fault-host/1", baseline,
    scope: "Explicit compute process crash cleanup/generation replacement, LB health epoch invalidation and read retry allowlist. Absent scenario preserves eight historical fixture outputs. No cache, CPU competitor, forced live retirement, activation or timing promotion.", files }, null, 2) + "\n");
}
