import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { productRoot } from "./product-source";
import { canonical } from "../../packages/simulation/src/model2/product/provenance";

export const meteringRoot = productRoot;
export const meteringDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export function meteringSourceHash() {
  const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(resolve(path, e.name)) : e.name.endsWith(".ts") ? [resolve(path, e.name)] : []);
  const folders = ["packages/simulation/src/model2", "packages/simulation/src/reality", "packages/simulation/tests", "scripts/reality", "scripts/tests"];
  const files = [...folders.flatMap((p) => walk(resolve(meteringRoot, p))), ...["docs/reality/m2j-source-lineage.json", "docs/reality/m2i-ec2-source.json", "docs/reality/m2i-source-reviews.json", "docs/reality/m2i-heldout-billing.json"].map((p) => resolve(meteringRoot, p))].sort();
  return meteringDigest(files.map((p) => [relative(meteringRoot, p).replaceAll("\\", "/"), readFileSync(p, "utf8").replaceAll("\r\n", "\n")]));
}
export function meteringArtifactBytes() {
  return readdirSync(resolve(meteringRoot, "docs/reality")).filter((p) => /^m2j-.*\.json$/.test(p)).reduce((n, p) => n + statSync(resolve(meteringRoot, "docs/reality", p)).size, 0);
}
