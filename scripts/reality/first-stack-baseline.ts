import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const commit = "bd5777e2157339f1a583fb4986843be8a046f0d2";
const file = "docs/reality/first-stack-baseline.json";
if (process.argv.includes("--write")) {
  if (process.argv.includes("--replace") || (() => { try { readFileSync(file); return true; } catch { return false; } })()) throw Error("Baseline already frozen");
  const read = (path: string) => execFileSync("git", ["show", `${commit}:${path}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).replaceAll("\r\n", "\n");
  const table = JSON.parse(read("apps/backend/executionIdentity/executionTransitions.json"));
  const descriptor = table.descriptors[table.entries[0].target];
  writeFileSync(file, JSON.stringify({ schema: "infraforge-first-stack-baseline/1", commit,
    source: table.entries[0].target, descriptor,
    compositions: JSON.parse(read("docs/reality/stage1-composition-hashes.json")),
    qualifiers: createHash("sha256").update(read("apps/backend/internalModel2/connectedScope.ts")).digest("hex"),
  }, null, 2) + "\n");
}
const frozen = JSON.parse(readFileSync(file, "utf8"));
if (frozen.commit !== commit || JSON.stringify(frozen.compositions) !== JSON.stringify(JSON.parse(readFileSync("docs/reality/stage1-composition-hashes.json", "utf8")))) throw Error("Stage 1 baseline drift");
if (createHash("sha256").update(readFileSync("apps/backend/internalModel2/connectedScope.ts", "utf8").replaceAll("\r\n", "\n")).digest("hex") !== frozen.qualifiers) throw Error("Legacy connected qualifiers changed");
console.info(JSON.stringify({ baseline: commit, source: frozen.source, preservedCompositions: frozen.compositions.length }));
