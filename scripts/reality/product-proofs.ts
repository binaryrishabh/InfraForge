import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { productFixture } from "../../packages/simulation/tests/productFixture";
import { compileProduct } from "../../packages/simulation/src/model2/product/compiler";
import { createProductModel2 } from "../../packages/simulation/src/model2/product/run";
import { presentModel2 } from "../../packages/simulation/src/model2/product/presentation";
import { productRoot, productHash, productSourceHash } from "./product-source";
import { checkProduct, generatedCompilerCases, generatedControllerCases } from "./product-cases";
import type { ProductEvidence } from "../../packages/simulation/src/model2/product/presentation";
export function compactProductEvidence(e: ProductEvidence) {
  // Complete authored/compiled inputs are retained once. Routine health trace duplication
  // is omitted explicitly; all state counters, ownership and controller events remain.
  const { provenance: _provenance, samples, product, computeProfiles: _profiles, computePolicyLedger: _policy, computeConfiguration: _compute, networkConfiguration: _network, dataConfiguration: _data, asyncConfiguration: _async, systemConfiguration: _systems, ...state } = e;
  const selected = e.network.trace.events.filter((t) => ["lb-selected", "backend-draining", "network-intervention"].includes(t.kind));
  return { ...state, samples: samples.map((s) => ({ at: s.at, counts: s.counts, resources: s.resources.filter((r) => r.id.startsWith("vm#") && !r.id.includes("/")) })), product: { versions: product.versions, controllers: product.controllers, scope: product.scope }, network: { ...e.network, trace: { ...e.network.trace, events: selected, additionalEventsOmitted: e.network.trace.events.length - selected.length, retention: "Only actual LB selections, drain and intervention events; full determinism/ownership checked before retention" } }, retainedInput: "See compiled.input and semantic for full profiles/provenance/configuration" };
}
export function productProofs() {
  const cases = [];
  for (const name of ["normal", "registry-outage", "stale-telemetry", "manual-drain", "warm-layers", "compute-crash"] as const) {
    const f = productFixture({ registryOutage: name === "registry-outage", observed: name === "stale-telemetry", monitorOutage: name === "stale-telemetry" });
    if (name === "manual-drain") f.contract.nodes.vm!.controller!.manual.push({ id: "operator-down", at: f.q.q("proof.manual.at", 75000, "us"), desired: f.q.q("proof.manual.desired", 1, "count") });
    if (name === "warm-layers") { const image = f.contract.nodes.vm!.resources.find((r) => r.role === "image")!.config; if (image.kind === "artifact-client") image.initialLayers = [{ digest: `sha256:${"a".repeat(64)}`, bytes: f.q.q("proof.initialLayer", 4096, "bytes") }]; }
    if (name === "compute-crash") f.contract.faults.push({ id: "process-crash", kind: "Crash", target: "vm", at: f.q.q("proof.crash.at", 70000, "us"), duration: f.q.q("proof.crash.down", 10000, "us"), restart: f.q.q("proof.crash.restart", 5000, "us"), profile: "retain-logical-state/1" });
    const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const runtime = createProductModel2(c.value); runtime.advanceTo(80000); const cut = runtime.evidence(); checkProduct(cut); runtime.advanceTo(runtime.horizon); const final = runtime.evidence(); checkProduct(final);
    cases.push({ name, authoredHash: productHash({ design: f.design, contract: f.contract }), compiledHash: productHash(c.value), design: f.design, contract: f.contract, compiled: c.value, cut: compactProductEvidence(cut), final: compactProductEvidence(final), presentation: presentModel2(final) });
  }
  return { schema: "infraforge-product-proofs/1", sourceHash: productSourceHash(), scope: "Actual saved-domain compile/run semantics, synthetic authored profiles; all physical M2G timing Unknown and earlier timing rejections preserved", complete: true, cases };
}
if (import.meta.main) {
  if (process.argv.includes("--sweeps")) {
    const sourceHash = productSourceHash(), compiler = generatedCompilerCases(); console.log(JSON.stringify({ stage: "compiler", ...compiler }));
    const controllers = generatedControllerCases(); const report = { schema: "infraforge-product-sweeps/1", sourceHash, complete: true, compiler, controllers };
    writeFileSync(resolve(productRoot, "docs/reality/m2h-sweeps.json"), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ stage: "controllers", ...controllers }));
  } else { const report = productProofs(); writeFileSync(resolve(productRoot, "docs/reality/m2h-proofs.json"), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ cases: report.cases.length, complete: report.complete, sourceHash: report.sourceHash })); }
}
