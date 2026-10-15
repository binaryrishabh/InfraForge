import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
export const productRoot = resolve(import.meta.dir, "../..");
export const productHash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function productSourceHash() {
  const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(resolve(path, e.name)) : e.name.endsWith(".ts") ? [resolve(path, e.name)] : []);
  const files = [...walk(resolve(productRoot, "packages/simulation/src/model2")), resolve(productRoot, "packages/simulation/tests/productFixture.ts"), resolve(productRoot, "scripts/reality/product-cases.ts"), resolve(productRoot, "packages/simulation/tests/productCases.ts"), resolve(productRoot, "packages/simulation/tests/systemsChecks.ts")].sort();
  return productHash(files.map((f) => [relative(productRoot, f).replaceAll("\\", "/"), readFileSync(f, "utf8").replaceAll("\r\n", "\n")]));
}
