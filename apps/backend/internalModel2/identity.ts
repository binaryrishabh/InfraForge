import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { canonical } from "@infraforge/simulation/internal-product";
export const hasher = { algorithm: "sha256-utf8/1" as const, hash: (text: string) => createHash("sha256").update(text).digest("hex") };
export const contentHash = (value: unknown) => hasher.hash(JSON.stringify(canonical(value)));
const root = resolve(import.meta.dir, "../../..");
function sourceIdentity() {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(resolve(dir, e.name)) : e.name.endsWith(".ts") ? [resolve(dir, e.name)] : []);
  const folders = ["packages/simulation/src/model2", "packages/simulation/src/reality", "packages/domain/src", "packages/catalog/src"];
  const paths = [...folders.flatMap((p) => walk(resolve(root, p))), ...["packages/simulation/src/internalProduct.ts", ...["identity", "envelope", "budgets", "capture"].map((p) => `apps/backend/internalModel2/${p}.ts`)].map((p) => resolve(root, p))]
    .map((p) => relative(root, p).replaceAll("\\", "/")).sort();
  const files = [...paths, "bun.lock", "apps/backend/zod_schemas/layout.schema.ts", "apps/backend/zod_schemas/deployment.schema.ts"].sort();
  return contentHash({ runtime: `bun-${Bun.version}`, files: files.map((p) => [p, readFileSync(resolve(root, p), "utf8").replaceAll("\r\n", "\n")]) });
}
// Frozen with this process/image; changing execution source requires a new process.
export const executionSource = sourceIdentity();
