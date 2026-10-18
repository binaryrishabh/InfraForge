import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonical } from "@infraforge/simulation/internal-product";
import { executionSourceFiles } from "./identity";
import { compatibleTransition } from "../executionIdentity/transitions";
interface SourceFile { path: string; hash: string; text?: string }
interface Lineage { baseline: string; source: string; runtime: string; original: SourceFile[]; current: Array<{ path: string; hash: string }>; execution: string[];
  reviewedExecution?: { baseline: string; source: string; original: SourceFile[]; context: SourceFile[]; inventory: string[] } }
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
function verifyDependencyContext(line: Lineage) {
  const paths = ["package.json", "bunfig.toml", "apps/backend/package.json", "apps/web/package.json", ...["catalog", "contracts", "domain", "simulation"].map(p => `packages/${p}/package.json`)];
  const pins = line.reviewedExecution?.context;
  if (!pins || digest(pins.map(p => p.path)) !== digest(paths)) throw Error("Dependency context inventory changed");
  if (digest(line.reviewedExecution?.inventory) !== digest(executionSourceFiles())) throw Error("Execution file inventory changed");
  for (const pin of pins) if (sha(lf(readFileSync(resolve(root, pin.path), "utf8"))) !== pin.hash) throw Error("Reviewed dependency context changed");
}
// One reviewed transition, not a version-wide or arbitrary historical-source allowance.
export function compatibleReviewedSource(recorded: string, current: string) {
  return compatibleTransition(recorded, current, root);
}
export function frozenReviewedSource(recorded: string, current: string) {
  if (recorded === current) return true;
  try {
    const line = legacyLineage(), review = line.reviewedExecution;
    if (!review || review.baseline !== "d4e742f5ee5d5e6853449245557e840cf31c2fa0" ||
        review.source !== "c978627d82007fc5e55f4bc653ea9132b3f185e381ac0d048afda1645d319ca6" ||
        recorded !== review.source || line.runtime !== `bun-${Bun.version}`) return false;
    verifyDependencyContext(line);
    // Check the full present execution inventory, including additions, before reconstructing old bytes.
    for (const path of executionSourceFiles().filter(p => p !== "apps/backend/internalModel2/legacyRuntime.json")) {
      const pin = line.current.find(p => p.path === path);
      if (!pin || sha(lf(readFileSync(resolve(root, path), "utf8"))) !== pin.hash) return false;
    }
    const files = review.original.map(p => {
      const text = p.text ?? lf(readFileSync(resolve(root, p.path), "utf8"));
      if (sha(text) !== p.hash) throw Error("Reviewed historical execution changed");
      return [p.path, text];
    });
    return digest({ runtime: line.runtime, files }) === recorded;
  } catch { return false; }
}
export function compatibleV1Source(recorded: string, current: string) {
  return compatibleTransition(recorded, current, root);
}
export function frozenV1Source(recorded: string, current: string) {
  if (frozenReviewedSource(recorded, current)) return true;
  try {
    const line = legacyLineage(); if (recorded !== line.source || line.runtime !== `bun-${Bun.version}`) return false;
    if (verified === undefined) {
      verifyDependencyContext(line);
      const runtime = (path: string) => path === "bun.lock" || path.startsWith("apps/backend/internalModel2/") || path.startsWith("apps/backend/zod_schemas/") || path.startsWith("packages/") && path.includes("/src/");
      for (const pin of line.current.filter(p => runtime(p.path))) if (sha(lf(readFileSync(resolve(root, pin.path), "utf8"))) !== pin.hash) throw Error("Reviewed v1 compatibility source drift");
      const files = line.execution.map(path => [path, baselineText(path, readFileSync(resolve(root, path), "utf8"))]);
      verified = digest({ runtime: line.runtime, files }) === line.source;
    }
    return verified;
  } catch { return false; }
}
