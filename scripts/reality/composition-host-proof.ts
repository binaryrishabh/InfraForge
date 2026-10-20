import { verifyBoundsPostgresReview } from "../stage2-bounds-host";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../.."), artifact = resolve(root, "docs/reality/stage1-extension-host.json");
const extension = "packages/simulation/src/model2/composition/token-bucket.ts";
function files(folder: string): string[] {
  return readdirSync(resolve(root, folder), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${folder}/${entry.name}`) : entry.name.endsWith(".ts") ? [`${folder}/${entry.name}`] : []);
}
export function compositionHostProof() {
  verifyBoundsPostgresReview();
  const bounds = JSON.parse(readFileSync(resolve(root, "docs/reality/first-stack-bounds-host.json"), "utf8"));
  const pg = JSON.parse(readFileSync(resolve(root, "docs/reality/postgres-session-source-review.json"), "utf8"));
  const allowed = ["composition/run.ts", "data/contracts.ts", "data/database.ts", "data/modules.ts", "data/run.ts", "data/validate.ts", "network/contracts.ts", "network/transport.ts"].map(path => "packages/simulation/src/model2/" + path).sort();
  if (bounds.schema !== "first-stack-bounds-host-review/1" || pg.schema !== "infraforge-postgres-session-source-review/1" || JSON.stringify(pg.files.map((f: { path: string }) => f.path).sort()) !== JSON.stringify(allowed)) throw Error("Invalid combined host review scope");
  const hash = (text: string) => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
  const originals = new Map<string, string>();
  for (const file of [...bounds.files, ...pg.files.map((f: { path: string; sha256: string; originalHash: string; original: string }) => ({ path: f.path, currentHash: f.sha256, originalHash: f.originalHash, originalText: f.original }))]) {
    if (hash(readFileSync(resolve(root, file.path), "utf8")) !== file.currentHash || hash(file.originalText) !== file.originalHash) throw Error(`Unreviewed combined host drift: ${file.path}`);
    const prior = originals.get(file.path);
    if (prior !== undefined && hash(prior) !== file.originalHash) throw Error("Inconsistent original host reviews");
    originals.set(file.path, file.originalText);
  }
  return files("packages/simulation/src/model2").filter(path => path !== extension).sort().map(path => ({ path,
    sha256: hash(originals.get(path) ?? readFileSync(resolve(root, path), "utf8")) }));
}
export function verifyCompositionHost() {
  const restored = compositionHostProof(), expected = JSON.parse(readFileSync(artifact, "utf8"));
  if (JSON.stringify(restored) !== JSON.stringify(expected)) throw Error("Extensibility baseline cannot be reconstructed; unreviewed host or peer change");
  return restored.length;
}
if (import.meta.main) {
  if (process.argv.includes("--write-baseline")) writeFileSync(artifact, JSON.stringify(compositionHostProof(), null, 2) + "\n");
  console.info(JSON.stringify({ reconstructedHistoricalHostAndPeerFiles: verifyCompositionHost(), reviewedPostgresDeltaFiles: 8, independentExtension: extension }));
}
