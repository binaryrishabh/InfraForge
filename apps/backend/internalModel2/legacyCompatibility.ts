import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonical } from "@infraforge/simulation/internal-product";
interface Lineage { baseline: string; source: string; runtime: string; original: Array<{ path: string; hash: string; text?: string }>; current: Array<{ path: string; hash: string }>; execution: string[] }
const root = resolve(import.meta.dir, "../../.."), lf = (s: string) => s.replaceAll("\r\n", "\n");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const digest = (v: unknown) => sha(JSON.stringify(canonical(v)));
let metadata: Lineage | undefined;
export function legacyLineage() {
  metadata ??= JSON.parse(readFileSync(resolve(root, "apps/backend/internalModel2/legacyRuntime.json"), "utf8"));
  if (metadata!.baseline !== "7e24ac77a868c9cec9e76141d29a156115238e91" || metadata!.source !== "bac35c995b5e5d59a9ce901745c014644fdb843183adbcbb761fb99184c11306") throw Error("Unsupported v1 compatibility lineage");
  return metadata!;
}
export function baselineText(path: string, current: string) {
  const line = legacyLineage(), pin = line.current.find(p => p.path === path), prior = line.original.find(p => p.path === path);
  if (!pin || sha(lf(current)) !== pin.hash || !prior) throw Error(`Unreviewed baseline source drift: ${path}`);
  const text = prior.text ?? lf(current);
  if (sha(text) !== prior.hash) throw Error(`Historical source changed: ${path}`);
  return text;
}
export function baselinePaths(paths: string[]) { const originals = new Set(legacyLineage().original.map(p => p.path)); return paths.filter(p => originals.has(p)); }
let verified: boolean | undefined;
export function compatibleV1Source(recorded: string, current: string) {
  if (recorded === current) return true;
  try {
    const line = legacyLineage(); if (recorded !== line.source || line.runtime !== `bun-${Bun.version}`) return false;
    if (verified === undefined) {
      const runtime = (path: string) => path === "bun.lock" || path.startsWith("apps/backend/internalModel2/") || path.startsWith("apps/backend/zod_schemas/") || path.startsWith("packages/") && path.includes("/src/");
      for (const pin of line.current.filter(p => runtime(p.path))) if (sha(lf(readFileSync(resolve(root, pin.path), "utf8"))) !== pin.hash) throw Error("Reviewed v1 compatibility source drift");
      const files = line.execution.map(path => [path, baselineText(path, readFileSync(resolve(root, path), "utf8"))]);
      verified = digest({ runtime: line.runtime, files }) === line.source;
    }
    return verified;
  } catch { return false; }
}
