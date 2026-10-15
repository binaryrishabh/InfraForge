import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileProduct } from "../../packages/simulation/src/model2/product/compiler";
import { validateLedger } from "../../packages/simulation/src/reality/ledger";
import type { productProofs } from "./product-proofs";
import { productHash, productRoot, productSourceHash } from "./product-source";
export function retainedProductProofs(root = productRoot) { return JSON.parse(readFileSync(resolve(root, "docs/reality/m2h-proofs.json"), "utf8")) as ReturnType<typeof productProofs>; }
export function validateProductArtifacts(root = productRoot) {
  const errors: string[] = [], proofs = retainedProductProofs(root), sourceHash = productSourceHash();
  if (proofs.schema !== "infraforge-product-proofs/1" || !proofs.complete || proofs.sourceHash !== sourceHash || proofs.cases.length !== 6) errors.push("M2H proof schema/source/completeness drift");
  for (const c of proofs.cases) {
    errors.push(...validateLedger(c.compiled.input.ledger));
    if (c.authoredHash !== productHash({ design: c.design, contract: c.contract }) || c.compiledHash !== productHash(c.compiled) || !c.compiled.semantic.numericOrigins.length || c.final.capture.failure || !c.final.capture.reachedHorizon) errors.push(`Invalid M2H proof ${c.name}`);
  }
  const sweep = JSON.parse(readFileSync(resolve(root, "docs/reality/m2h-sweeps.json"), "utf8"));
  if (!sweep.complete || sweep.sourceHash !== sourceHash || sweep.compiler.count !== 2048 || sweep.compiler.valid !== 1536 || sweep.compiler.refused !== 512 || sweep.controllers.count !== 2048 || sweep.controllers.replays !== 16 || sweep.controllers.created <= 2048 || !sweep.controllers.artifactFailures) errors.push("M2H generated campaign incomplete/source drift");
  const perf = JSON.parse(readFileSync(resolve(root, "docs/reality/m2h-performance.json"), "utf8"));
  if (!perf.complete || perf.sourceHash !== sourceHash || perf.cases.length !== 6 || perf.cases.some((c: Record<string, unknown>) => ["compileMs", "setupMs", "executionMs", "evidenceMs", "serializeMs"].some((k) => typeof c[k] !== "number" || (c[k] as number) < 0))) errors.push("M2H executor measurement incomplete/source drift");
  return errors;
}
export function replayProductCompilation() {
  const failures: string[] = [];
  for (const c of retainedProductProofs().cases) { const result = compileProduct(c.design, c.contract); if (!result.ok || productHash(result.value) !== c.compiledHash) failures.push(c.name); }
  return failures;
}
if (import.meta.main) { const errors = [...validateProductArtifacts(), ...replayProductCompilation()]; if (errors.length) throw Error(errors.join("\n")); console.log("M2H: six saved-domain proofs and exact-source sweep/performance artifacts valid; Model 2 remains internal"); }
