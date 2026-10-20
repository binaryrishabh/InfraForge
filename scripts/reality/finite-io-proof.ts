import { readFileSync, writeFileSync } from "node:fs";
import { firstStackIoFixture } from "../fixtures/first-stack-io";
import { createFirstStackRuntime } from "../../packages/simulation/src/firstStack/run";
import { compileFirstStackIo } from "../../packages/simulation/src/firstStack/io";
import { canonical } from "../../packages/simulation/src/model2/product/provenance";
import { digest, sourceHash } from "../../apps/backend/executionIdentity/hash";
import { compositionProofs } from "./composition-proofs";
import { finiteIoFixture, ioInvocation } from "../../packages/simulation/tests/finiteIoFixture";
import { finiteIoRuntime } from "../../packages/simulation/src/model2/data/io";
import { relationalDatabase } from "../../packages/simulation/src/model2/data/database";
import { validateFiniteIo } from "../../packages/simulation/src/model2/data/io-contract";
import { EventKernel } from "../../packages/simulation/src/model2/time";

const artifact = "docs/reality/finite-io-proof.json";
export const finiteIoSources = ["packages/simulation/src/model2/composition/io-budget.ts", "packages/simulation/src/model2/data/io-contract.ts", "packages/simulation/src/model2/data/io.ts", "packages/simulation/src/model2/data/database.ts", "packages/simulation/src/model2/data/run.ts", "packages/simulation/src/model2/data/modules.ts", "packages/simulation/src/model2/composition/run.ts", "packages/simulation/src/firstStack/io.ts", "packages/simulation/src/firstStack/run.ts", "packages/simulation/src/internalFirstStack.ts", "packages/simulation/tests/finiteIo.test.ts", "packages/simulation/tests/finiteIoFixture.ts", "scripts/tests/finite-io.test.ts", "scripts/fixtures/first-stack-io.ts", "scripts/reality/finite-io-proof.ts"];
export async function finiteIoProof() {
  const cases = [];
  for (const warm of [false, true]) {
    const f = await firstStackIoFixture(warm), compiled = compileFirstStackIo(f.sidecar, f.schedule, f.policy, f.profile);
    const run = (observe = false) => {
      const runtime = createFirstStackRuntime(f.sidecar, f.schedule, f.policy, observe ? () => {} : undefined, f.profile);
      runtime.advanceTo(runtime.horizon); return runtime.evidence();
    };
    const e = run(); if (digest(e) !== digest(run(true)) || digest(e) !== digest(run())) throw Error("IO replay/observer inequality");
    cases.push({ warm, compiledHash: digest(canonical(compiled)), evidenceHash: digest(canonical(e)), counts: e.counts,
      storage: e.composition.storage, memory: e.composition.memory, maxResponseUs: Math.max(...e.results.map(r => r.responseUs)), observerEqual: true, repeatedEqual: true });
  }
  const historical = compositionProofs();
  if (digest(historical) !== digest(JSON.parse(readFileSync("docs/reality/stage1-composition-hashes.json", "utf8")))) throw Error("Historical IO regression");
  const databases = ["wal-commit-detach", "two-roles-shared-io", "cancelled-page-read"].map(name => {
    const f = finiteIoFixture(), second = structuredClone(f.config); second.id = "db2"; second.execution.id = "db2";
    if (name === "two-roles-shared-io") {
      f.input.resources.push(second); f.input.endpoints.db2 = { alive: true, ready: true };
      f.composition.bindings.push({ ...f.composition.bindings[1]!, resource: "db2" });
      f.profile.bindings.push(...f.profile.bindings.map(b => ({ ...structuredClone(b), role: "db2" })));
    }
    validateFiniteIo(f.profile, f.input, f.composition);
    const clock = new EventKernel(1000), io = finiteIoRuntime(f.profile, clock), a = relationalDatabase(f.config, clock, undefined, undefined, io.forRole("db"));
    a.openSession("a"); const receipt = a.accept(ioInvocation("a", "heavy"), () => {});
    const b = name === "two-roles-shared-io" ? relationalDatabase(second, clock, undefined, undefined, io.forRole("db2")) : undefined;
    if (b) { b.openSession("b"); b.accept(ioInvocation("b", "heavy", "k1"), () => {}); }
    clock.advanceTo(name === "cancelled-page-read" ? 1 : 101);
    const cancellation = receipt.cancel(); a.closeSession("a"); clock.advanceTo(1000);
    const storage = io.evidence(), ledger = storage.devices[0]!;
    if (ledger.accepted.operations !== ledger.completed.operations + ledger.cancelled.operations || ledger.accepted.bytes !== ledger.completed.bytes + ledger.cancelled.bytes) throw Error("IO conservation proof failed");
    return { name, cancellation, database: a.evidence(), peer: b?.evidence() ?? null, storage };
  });
  return { schema: "finite-io-proof/1", timing: "assumption-only", activeEngine: "1", scope: "Authored finite logical IO; no physical calibration or activation", historical,
    sources: finiteIoSources.map(path => ({ path, sha256: sourceHash(readFileSync(path, "utf8")) })), cases, databases };
}
export async function verifyFiniteIoProof(write = false) {
  const current = await finiteIoProof();
  if (write) writeFileSync(artifact, JSON.stringify(current, null, 2) + "\n");
  if (digest(current) !== digest(JSON.parse(readFileSync(artifact, "utf8")))) throw Error("Finite IO proof drift; review and run its producer with --write");
  return { cases: current.cases.length, databaseCases: current.databases.length, historicalCompositions: current.historical.length, observerEqual: true, repeatedEqual: true };
}
if (import.meta.main) console.info(JSON.stringify(await verifyFiniteIoProof(process.argv.includes("--write"))));
