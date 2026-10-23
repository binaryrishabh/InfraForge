import { readArtifactText } from "./frozen-artifacts";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { productHash, productRoot } from "./product-source";
import { providerDigest } from "./provider-source";
import { baselinePaths, baselineText } from "../../apps/backend/internalModel2/legacyCompatibility";

const accepted = "5b4771ac107e447aa08aac146b8ff15f019beac9";
const foundation = "d1fe122d5a502dc916190a6d487cc72c4965bc0d563a92222166f0c130b74dfe";
const provider = "11fc05c4f569e1a3faa19b1a8a2ef73eba8706df8790ddf5eb9868b27e434d3c";
const changed = ["async/commands.ts", "async/objects.ts", "async/run.ts", "network/link.ts", "network/run.ts", "network/transport.ts", "systems/run.ts", "product/run.ts"]
  .map((p) => `packages/simulation/src/model2/${p}`).concat("scripts/reality/provider-proofs.ts");
const artifacts = ["m2h-ledger", "m2h-performance", "m2h-proofs", "m2h-sweeps", "m2i-ec2-source", "m2i-heldout-billing", "m2i-performance", "m2i-proofs", "m2i-source-reviews"].map((p) => `docs/reality/${p}.json`);
const normalize = (text: string) => text.replaceAll("\r\n", "\n");
const sha = (text: string) => createHash("sha256").update(normalize(text)).digest("hex");
export interface SourceLineage {
  schema: string;
  acceptedSha: string;
  foundationHash: string;
  providerHash: string;
  files: Array<{ path: string; originalSha256: string; currentSha256: string; originalText: string }>;
  artifacts: Array<{ path: string; sha256: string }>;
}
export const readLineage = (root = productRoot): SourceLineage => JSON.parse(readFileSync(resolve(root, "docs/reality/m2j-source-lineage.json"), "utf8"));
export function sourceProjection(lineage: SourceLineage, read: (path: string) => string) {
  if (lineage.schema !== "infraforge-runtime-source-lineage/1" || lineage.acceptedSha !== accepted || lineage.foundationHash !== foundation || lineage.providerHash !== provider || lineage.files.length !== changed.length || new Set(lineage.files.map((f) => f.path)).size !== changed.length) throw Error("Invalid accepted source lineage identity");
  const originals = new Map<string, string>();
  for (const f of lineage.files) {
    if (!changed.includes(f.path) || sha(f.originalText) !== f.originalSha256 || !/^[a-f0-9]{64}$/.test(f.currentSha256) || sha(baselineText(f.path, read(f.path))) !== f.currentSha256) throw Error(`Unreviewed source lineage drift: ${f.path}`);
    originals.set(f.path, normalize(f.originalText));
  }
  return (path: string) => originals.get(path) ?? baselineText(path, read(path));
}
function foundationFiles(root: string) {
  const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(resolve(path, e.name)) : e.name.endsWith(".ts") ? [resolve(path, e.name)] : []);
  return [...walk(resolve(root, "packages/simulation/src/model2")), ...["packages/simulation/tests/productFixture.ts", "scripts/reality/product-cases.ts", "packages/simulation/tests/productCases.ts", "packages/simulation/tests/systemsChecks.ts"].map((p) => resolve(root, p))].sort().map((p) => relative(root, p).replaceAll("\\", "/"));
}
export function historicalFoundationHash(root = productRoot, lineage = readLineage(root)) {
  const original = sourceProjection(lineage, (path) => readFileSync(resolve(root, path), "utf8"));
  const result = productHash(baselinePaths(foundationFiles(root)).map((p) => [p, original(p)]));
  if (result !== foundation) throw Error("Accepted M2H source fingerprint cannot be reconstructed");
  return result;
}
export function historicalProviderHash(root = productRoot, lineage = readLineage(root)) {
  const original = sourceProjection(lineage, (path) => readFileSync(resolve(root, path), "utf8"));
  const folder = resolve(root, "packages/simulation/src/reality/provider");
  const paths = [...readdirSync(folder).filter((p) => p.endsWith(".ts")).map((p) => `packages/simulation/src/reality/provider/${p}`),
    "packages/simulation/tests/providerFixture.ts", "packages/simulation/tests/providerCases.ts", "scripts/reality/provider-source.ts", "scripts/reality/provider-proofs.ts", "scripts/reality/provider-performance.ts", "docs/reality/m2i-ec2-source.json", "docs/reality/m2i-source-reviews.json", "docs/reality/m2i-heldout-billing.json"].sort();
  const result = providerDigest({ foundation: historicalFoundationHash(root, lineage), files: paths.map((p) => [p, original(p)]) });
  if (result !== provider) throw Error("Accepted M2I source fingerprint cannot be reconstructed");
  return result;
}
export function verifyHistoricalArtifacts(root = productRoot) {
  const lineage = readLineage(root);
  if (lineage.artifacts.length !== 9 || new Set(lineage.artifacts.map((a) => a.path)).size !== 9) throw Error("Historical artifact inventory drift");
  for (const a of lineage.artifacts) if (!artifacts.includes(a.path) || sha(readArtifactText(root, a.path)) !== a.sha256) throw Error(`Historical artifact changed: ${a.path}`);
}
export function refreshCurrentSourcePins(root = productRoot) {
  const lineage = readLineage(root);
  for (const f of lineage.files) f.currentSha256 = sha(readFileSync(resolve(root, f.path), "utf8"));
  // Original bytes/identities are immutable; verify them before saving the current pins.
  sourceProjection(lineage, (path) => readFileSync(resolve(root, path), "utf8"));
  historicalFoundationHash(root, lineage); historicalProviderHash(root, lineage); verifyHistoricalArtifacts(root);
  writeFileSync(resolve(root, "docs/reality/m2j-source-lineage.json"), JSON.stringify(lineage, null, 2) + "\n");
}
if (import.meta.main) {
  if (process.argv.includes("--refresh-current")) refreshCurrentSourcePins();
  console.info(JSON.stringify({ accepted, foundation: historicalFoundationHash(), provider: historicalProviderHash() }));
  verifyHistoricalArtifacts();
}
