import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { sourceHash } from "../apps/backend/executionIdentity/hash";

export const boundsHostPaths = ["time.ts", "composition/run.ts", "compute/run.ts", "data/run.ts", "network/run.ts", "network/trace.ts", "network/transport.ts", "workload/contracts.ts", "workload/evidence.ts", "workload/run.ts"].map(p => "packages/simulation/src/model2/" + p);
const path = "docs/reality/first-stack-bounds-host.json";
export function writeBoundsHostReview() {
  const baseline = "8141673ffcb48d0ac6d9855ea9fe46a563095cc4";
  const expected = JSON.parse(readFileSync("docs/reality/stage1-extension-host.json", "utf8")) as Array<{ path: string; sha256: string }>;
  const files = boundsHostPaths.map(path => {
    const originalText = execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
    if (sourceHash(originalText) !== expected.find(p => p.path === path)?.sha256) throw Error(`Unexpected pre-bounds host: ${path}`);
    return { path, originalText, originalHash: sourceHash(originalText), currentHash: sourceHash(readFileSync(path, "utf8")) };
  });
  writeFileSync(path, JSON.stringify({ schema: "first-stack-bounds-host-review/1", baseline,
    review: "Optional finite first-stack host budgets and slice API; absent budgets preserve eight historical replay hashes. Original Stage 1 host bytes retained, not claimed to be current. No relational mechanism changes.", files }, null, 2) + "\n");
}
if (import.meta.main && process.argv.includes("--write")) writeBoundsHostReview();
