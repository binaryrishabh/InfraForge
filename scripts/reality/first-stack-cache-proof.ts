import { readFileSync, writeFileSync } from "node:fs";
import { firstStackCacheFixture } from "../fixtures/first-stack-cache";
import { runFirstStackQualification } from "../../apps/backend/firstStack/execution";
import { hash } from "../../apps/backend/firstStack/canonical";

export async function cacheProof() {
  const cases = [];
  for (const apps of [1, 2, 8]) for (const warm of [false, true]) for (const coalesce of [false, true]) {
    const f = await firstStackCacheFixture({ apps, warm, coalesce }), p = f.prepare();
    const off = runFirstStackQualification(p), on = runFirstStackQualification(p, () => {});
    if (hash(off) !== hash(on)) throw Error("Cache observer changed execution");
    cases.push({ apps, warm, coalesce, compiled: hash(p.compiled), evidence: hash(off.evidence),
      counts: off.evidence.counts, caches: off.evidence.data.caches, policies: off.evidence.data.applications });
  }
  return { schema: "first-stack-cache-proof/1", compiler: "first-stack-compiler/3", activeEngine: "1", timing: "assumption-only", fullMemory: "Unknown", fullCost: "Unknown", cases };
}
if (import.meta.main) {
  const path = new URL("../../docs/reality/first-stack-cache-proof.json", import.meta.url), actual = await cacheProof();
  if (process.argv.includes("--write")) writeFileSync(path, JSON.stringify(actual, null, 2) + "\n");
  if (JSON.stringify(actual) !== JSON.stringify(JSON.parse(readFileSync(path, "utf8")))) throw Error("Cache proof drift");
  console.log(JSON.stringify({ result: "PASS", cases: actual.cases.length, observerEquality: true, timingPromotion: false }));
}
