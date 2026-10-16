import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { meteringDigest, meteringRoot } from "./reality/metering-source";
import { baselinePaths, baselineText } from "../apps/backend/internalModel2/legacyCompatibility";
const acceptedHash = "d9802e09b0d71796eccc181d3fe32d3d9e1b1c1b6370aba61b61d566d8ed61db";
const paths = ["packages/simulation/src/reality/metering/link-meter.ts", "packages/simulation/src/reality/metering/object-meter.ts", "scripts/reality/metering-proofs.ts", "scripts/tests/meteringArtifacts.test.ts", "scripts/reality/classify.ts", "scripts/tests/reality.test.ts"];
const artifacts = ["docs/reality/m2j-proofs.json", "docs/reality/m2j-performance.json", "docs/reality/m2j-source-lineage.json"];
const normalize = (s: string) => s.replaceAll("\r\n", "\n");
const hash = (s: string) => createHash("sha256").update(normalize(s)).digest("hex");
interface Lineage { schema: string; acceptedSha: string; sourceHash: string; files: Array<{ path: string; originalText: string; originalHash: string; currentHash: string }>; artifacts: Array<{ path: string; hash: string }> }
const file = resolve(meteringRoot, "docs/reality/m2k-source-lineage.json");
export function historicalMeteringHash(refresh = false) {
  const lineage: Lineage = JSON.parse(readFileSync(file, "utf8"));
  if (lineage.schema !== "infraforge-m2j-lineage/1" || lineage.acceptedSha !== "094841dc031e2f68f18798f58e8b7eaa9f909d89" || lineage.sourceHash !== acceptedHash || lineage.files.length !== paths.length || new Set(lineage.files.map((f) => f.path)).size !== paths.length) throw Error("Accepted M2J source lineage identity drift");
  const originals = new Map<string, string>();
  for (const f of lineage.files) {
    const current = hash(baselineText(f.path, readFileSync(resolve(meteringRoot, f.path), "utf8")));
    if (refresh) f.currentHash = current;
    if (!paths.includes(f.path) || hash(f.originalText) !== f.originalHash || current !== f.currentHash) throw Error(`M2J source lineage drift: ${f.path}`);
    originals.set(f.path, normalize(f.originalText));
  }
  if (lineage.artifacts.length !== artifacts.length || new Set(lineage.artifacts.map((a) => a.path)).size !== artifacts.length) throw Error("M2J artifact inventory drift");
  for (const a of lineage.artifacts) if (!artifacts.includes(a.path) || hash(readFileSync(resolve(meteringRoot, a.path), "utf8")) !== a.hash) throw Error("Accepted M2J artifact changed");
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(resolve(dir, e.name)) : e.name.endsWith(".ts") ? [resolve(dir, e.name)] : []);
  const files = [...["packages/simulation/src/model2", "packages/simulation/src/reality", "packages/simulation/tests", "scripts/reality", "scripts/tests"].flatMap((p) => walk(resolve(meteringRoot, p))),
    ...["docs/reality/m2j-source-lineage.json", "docs/reality/m2i-ec2-source.json", "docs/reality/m2i-source-reviews.json", "docs/reality/m2i-heldout-billing.json"].map((p) => resolve(meteringRoot, p))].sort();
  const result = meteringDigest(baselinePaths(files.map(p => relative(meteringRoot, p).replaceAll("\\", "/"))).map(id => [id, originals.get(id) ?? baselineText(id, readFileSync(resolve(meteringRoot, id), "utf8"))]));
  if (result !== acceptedHash) throw Error("Accepted M2J source cannot be reconstructed");
  if (refresh) writeFileSync(file, JSON.stringify(lineage, null, 2) + "\n");
  return result;
}
if (import.meta.main) console.info(historicalMeteringHash(process.argv.includes("--refresh-current")));
