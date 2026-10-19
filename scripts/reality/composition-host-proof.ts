import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../.."), artifact = resolve(root, "docs/reality/stage1-extension-host.json");
const extension = "packages/simulation/src/model2/composition/token-bucket.ts";
function files(folder: string): string[] {
  return readdirSync(resolve(root, folder), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${folder}/${entry.name}`) : entry.name.endsWith(".ts") ? [`${folder}/${entry.name}`] : []);
}
export function compositionHostProof() {
  return files("packages/simulation/src/model2").filter(path => path !== extension).sort().map(path => ({
    path, sha256: createHash("sha256").update(readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n")).digest("hex"),
  }));
}
export function verifyCompositionHost() {
  const current = compositionHostProof(), expected = JSON.parse(readFileSync(artifact, "utf8"));
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw Error("Extensibility proof changed the kernel, host or a peer resource module");
  return current.length;
}
if (import.meta.main) {
  if (process.argv.includes("--write-baseline")) writeFileSync(artifact, JSON.stringify(compositionHostProof(), null, 2) + "\n");
  console.info(JSON.stringify({ unchangedHostAndPeerFiles: verifyCompositionHost(), independentExtension: extension }));
}
