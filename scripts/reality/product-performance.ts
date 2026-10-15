import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { platform, release, cpus } from "node:os";
import { productFixture } from "../../packages/simulation/tests/productFixture";
import { compileProduct } from "../../packages/simulation/src/model2/product/compiler";
import { createProductModel2 } from "../../packages/simulation/src/model2/product/run";
import { presentModel2 } from "../../packages/simulation/src/model2/product/presentation";
import { productRoot, productHash, productSourceHash } from "./product-source";
import { checkProduct } from "./product-cases";
function diagram(count: number) {
  const f = productFixture({ slots: 3, max: 2, horizon: 40000 }), vm = f.contract.nodes.vm!, base = vm.resources.find((r) => r.role === "main")!.config;
  if (base.kind !== "compute") throw Error("Missing compute profile");
  for (let n = f.design.resources.length; n < count; n++) {
    const id = `service_${n}`; f.design.resources.push({ id, type: "Virtual Machine", x: n * 100, y: 10 });
    f.contract.nodes[id] = { type: "Virtual Machine", profileVersion: "1", provenance: ["Explicit synthetic independent service with monitoring-target edge; no traffic/capacity claim"], primary: "main", securityReplacement: "explicit-reviewed/1", resources: [{ role: "main", config: { ...structuredClone(base), downstream: undefined } }], identities: [{ role: "main", address: `198.18.0.${n}`, zone: "internal" }], listeners: vm.listeners.filter((l) => l.role === "main"), internalEdges: [] };
    const edge = `observe_${id}`; f.design.connections.push({ id: edge, sourceId: "monitor", targetId: id, sourceType: "Monitoring Agent", targetType: "Virtual Machine", port: 8080 }); f.contract.edges[edge] = structuredClone(f.contract.edges.observe!); f.contract.instrumentation.push({ target: `$${id}`, bytes: f.contract.instrumentation[0]!.bytes });
  }
  return f;
}
export function productPerformance() {
  const rows = [];
  for (const name of ["diagram-32", "diagram-128", "pool-8", "pool-32", "controller-churn", "controller-evaluations"] as const) {
    const f = name === "diagram-32" ? diagram(32) : name === "diagram-128" ? diagram(128) : productFixture({ slots: name === "pool-32" ? 32 : 16, max: name === "pool-32" ? 32 : 8, min: name === "pool-32" ? 32 : 8, horizon: 120000 });
    if (name === "controller-churn") { const p = f.contract.nodes.vm!.controller!; for (let n = 0; n < 10; n++) p.manual.push({ id: `operator-${n}`, at: f.q.q(`churn.${n}.at`, 10000 + n * 10000, "us"), desired: f.q.q(`churn.${n}.desired`, n % 2 ? 8 : 1, "count") }); p.min = f.q.q("churn.min", 1, "count"); f.design.resources.find((r) => r.id === "vm")!.autoscaling!.minReplicas = 1; }
    if (name === "controller-evaluations") { const p = f.contract.nodes.vm!.controller!; p.interval = f.q.q("dense.interval", 100, "us"); }
    const before = performance.now(), c = compileProduct(f.design, f.contract), compileMs = performance.now() - before; if (!c.ok) throw Error(`${name}: ${JSON.stringify(c.diagnostics)}`);
    const setupAt = performance.now(), r = createProductModel2(c.value), setupMs = performance.now() - setupAt;
    const runAt = performance.now(); r.advanceTo(r.horizon); const executionMs = performance.now() - runAt;
    const evidenceAt = performance.now(), e = r.evidence(), presentation = presentModel2(e), evidenceMs = performance.now() - evidenceAt; checkProduct(e);
    const serializeAt = performance.now(), json = JSON.stringify({ e, presentation }), serializeMs = performance.now() - serializeAt;
    rows.push({ name, authoredHash: productHash({ design: f.design, contract: f.contract }), compiledHash: productHash(c.value), productNodes: f.design.resources.length, resources: c.value.input.resources.length, paths: c.value.input.paths.length, compileMs, setupMs, executionMs, evidenceMs, serializeMs, retainedBytes: Buffer.byteLength(json), processHeapUsed: process.memoryUsage().heapUsed, events: e.execution, counts: e.counts, controllers: e.product.controllers.map((p) => ({ id: p.id, evaluations: p.evaluations, populations: p.populations, created: p.replicas.filter((r) => r.createdAt !== null).length, identityBudgetExhausted: p.identityBudgetExhausted })), numericOrigins: c.value.semantic.numericOrigins.length });
  }
  return { schema: "infraforge-product-performance/1", sourceHash: productSourceHash(), host: { runtime: `Bun ${process.versions.bun}`, nodeCompatibility: process.version, platform: platform(), release: release(), cpu: cpus()[0]!.model }, complete: true, scope: "Executor wall costs of synthetic authored compiler/controller workloads. Heap includes prior cases/GC; no infrastructure/provider timing or cost claim; compilation includes existing validators", cases: rows };
}
if (import.meta.main) { const report = productPerformance(); writeFileSync(resolve(productRoot, "docs/reality/m2h-performance.json"), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report)); }
