import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { canonical } from "../../packages/simulation/src/model2/product/provenance";
import { createHash } from "node:crypto";
import { productRoot, productSourceHash } from "./product-source";
export const providerRoot = productRoot;
export const providerDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export function providerSourceHash() {
  const folder = resolve(providerRoot, "packages/simulation/src/reality/provider");

  const files = [
    ...readdirSync(folder).filter((f) => f.endsWith(".ts")).map((f) => resolve(folder, f)),

    ...[
      "packages/simulation/tests/providerFixture.ts",

      "packages/simulation/tests/providerCases.ts",

      "scripts/reality/provider-source.ts",

      "scripts/reality/provider-proofs.ts",

      "scripts/reality/provider-performance.ts",

      "docs/reality/m2i-ec2-source.json",

      "docs/reality/m2i-source-reviews.json",

      "docs/reality/m2i-heldout-billing.json"
    ].map((f) => resolve(providerRoot, f))
  ].sort();

  return providerDigest({
    foundation: productSourceHash(),

    files: files.map((f) => [relative(providerRoot, f).replaceAll("\\", "/"), readFileSync(f, "utf8").replaceAll("\r\n", "\n")])
  });
}
export function providerArtifactBytes() {
  return readdirSync(resolve(providerRoot, "docs/reality")).filter((f) => /^m2i-.*\.json$/.test(f)).reduce((n, f) => n + statSync(resolve(providerRoot, "docs/reality", f)).size, 0);
}
