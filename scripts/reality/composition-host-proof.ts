import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../.."), artifact = resolve(root, "docs/reality/stage1-extension-host.json");
const extension = "packages/simulation/src/model2/composition/token-bucket.ts";
function files(folder: string): string[] {
  return readdirSync(resolve(root, folder), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${folder}/${entry.name}`) : entry.name.endsWith(".ts") ? [`${folder}/${entry.name}`] : []);
}
export function compositionHostProof() {
  const review = JSON.parse(readFileSync(resolve(root, "docs/reality/first-stack-bounds-host.json"), "utf8")) as { schema: string; files: Array<{ path: string; currentHash: string; originalHash: string; originalText: string }> };
  if (review.schema !== "first-stack-bounds-host-review/1") throw Error("Unknown bounds host review");
  const hash = (text: string) => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
  for (const file of review.files) if (hash(readFileSync(resolve(root, file.path), "utf8")) !== file.currentHash || hash(file.originalText) !== file.originalHash) throw Error(`Unreviewed bounds host drift: ${file.path}`);
  // Reconstruct the original independent-extension scope. Fresh bounded-host
  // behavior is qualified separately; the immutable Stage 1 baseline stays intact.

  return files("packages/simulation/src/model2").filter(path => path !== extension).sort().map(path => ({
    path, sha256: createHash("sha256").update((review.files.find(file => file.path === path)?.originalText ?? readFileSync(resolve(root, path), "utf8")).replaceAll("\r\n", "\n")).digest("hex"),
  }));
}
export function verifyCompositionHost() {
  const current = compositionHostProof(), expected = JSON.parse(readFileSync(artifact, "utf8"));
  // The original extension proof stays frozen. Later opt-in profiles carry an
  // exact source review and retained original text; do not overwrite its baseline.
  const review = JSON.parse(readFileSync(resolve(root, "docs/reality/postgres-session-source-review.json"), "utf8"));
  const allowed = ["composition/run.ts", "data/contracts.ts", "data/database.ts", "data/modules.ts", "data/run.ts", "data/validate.ts", "network/contracts.ts", "network/transport.ts"].map(path => "packages/simulation/src/model2/" + path).sort();
  if (review.schema !== "infraforge-postgres-session-source-review/1" || JSON.stringify(review.files.map((file: { path: string }) => file.path).sort()) !== JSON.stringify(allowed)) throw Error("Invalid PostgreSQL host delta scope");
  const restored = current.map(entry => {
    const delta = review.files.find((file: { path: string }) => file.path === entry.path);
    if (!delta) return entry;
    if (entry.sha256 !== delta.sha256 || createHash("sha256").update(delta.original.replaceAll("\r\n", "\n")).digest("hex") !== delta.originalHash) throw Error(`Reviewed PostgreSQL profile changed: ${entry.path}`);
    return { path: entry.path, sha256: delta.originalHash };
  });
  if (JSON.stringify(restored) !== JSON.stringify(expected)) throw Error("Extensibility baseline cannot be reconstructed; unreviewed host or peer change");
  return current.length;
}
if (import.meta.main) {
  if (process.argv.includes("--write-baseline")) writeFileSync(artifact, JSON.stringify(compositionHostProof(), null, 2) + "\n");
  console.info(JSON.stringify({ reconstructedHistoricalHostAndPeerFiles: verifyCompositionHost(), reviewedPostgresDeltaFiles: 8, independentExtension: extension }));
}
