import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { sourceHash } from "../apps/backend/executionIdentity/hash";
import { beforeFiniteIo } from "./finite-io-source-review";


// Exact main PG behavior is retained; only the slice API and optional call guard differ.
const postgresBaseline = "6501ad38e0b42a20a67e3122ea64ce4c886f7d63";
const mainPostgresHashes: Record<string, string> = {
  "packages/simulation/src/model2/composition/run.ts": "c33b191c6b0fd13003dc7c317cdcaf4a8ddcdd8ffaa7875c847143d465dd983b",
  "packages/simulation/src/model2/data/contracts.ts": "bcf44a048f028d99554a82a344a5535ab182a803645bd143e146a6f42d727f26",
  "packages/simulation/src/model2/data/database.ts": "818065a584a3bec6f3e837bf8bfa6a199e49178fc720bc58565d09667e1b5daf",
  "packages/simulation/src/model2/data/modules.ts": "d3d197b1907e1476d3db95b2ec5d7f705043e0916143fb9d8bd803428b73c142",
  "packages/simulation/src/model2/data/run.ts": "44cffa676dba668b72635efeb72ee5c4e5c8bc45926798cca68081baadb75ed8",
  "packages/simulation/src/model2/data/validate.ts": "0dff55eb16a9abad7fd12db65b0a1298df89cfddfffa543e7b640e6e8188ac44",
  "packages/simulation/src/model2/network/contracts.ts": "a55f006f05a61fd5214a2be8d5174f197c398f7c3eb78efdb520ecb9796a32a5",
  "packages/simulation/src/model2/network/transport.ts": "997f92945e84a7a8dbc23b4830bce0b92374af68604e1bf9cddec4a775db08e1"
};
export const boundsPostgresPaths = Object.keys(mainPostgresHashes).sort();
const withoutBounds = (path: string, text: string) => path.endsWith("/transport.ts")
  ? text.replace(", callBudget?: { enter(): () => void }", "").replace("      const releaseCall = callBudget?.enter();\n", "").replace("releaseCall?.(); ", "")
  : text.replace(", advanceSlice: runtime.advanceSlice", "");
export function verifyBoundsPostgresReview() {
  const review = JSON.parse(readFileSync("docs/reality/first-stack-bounds-host.json", "utf8"));
  if (review.postgresBaseline !== postgresBaseline || JSON.stringify(review.postgres.map((f: { path: string }) => f.path)) !== JSON.stringify(boundsPostgresPaths)) throw Error("Invalid combined PostgreSQL review scope");
  for (const file of review.postgres) {
    const text = beforeFiniteIo(file.path, readFileSync(file.path, "utf8").replaceAll("\r\n", "\n"));
    if (sourceHash(file.originalText) !== mainPostgresHashes[file.path] || sourceHash(text) !== file.currentHash || withoutBounds(file.path, text) !== file.originalText) throw Error(`Main PostgreSQL behavior changed: ${file.path}`);
  }
}

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
  const postgres = boundsPostgresPaths.map(path => {
    const originalText = execFileSync("git", ["show", `${postgresBaseline}:${path}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
    const current = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    if (sourceHash(originalText) !== mainPostgresHashes[path] || withoutBounds(path, current) !== originalText) throw Error(`Outside slice/call-budget PG integration: ${path}`);
    return { path, originalText, currentHash: sourceHash(current) };
  });
  writeFileSync(path, JSON.stringify({ postgresBaseline, postgres, schema: "first-stack-bounds-host-review/1", baseline,
    review: "Optional finite first-stack host budgets and slice API; absent budgets preserve eight historical replay hashes. Original Stage 1 host bytes retained, not claimed to be current. No relational mechanism changes.", files }, null, 2) + "\n");
  verifyBoundsPostgresReview();
}
if (import.meta.main && process.argv.includes("--write")) writeBoundsHostReview();
