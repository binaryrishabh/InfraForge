import { createHash } from "node:crypto";
import { productFixture } from "./productFixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { checkSystems } from "./systemsChecks";
import type { ProductEvidence } from "../src/model2/product/presentation";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const assert = (v: boolean, reason: string) => { if (!v) throw Error(reason); };
export function checkProduct(e: ProductEvidence) {
  checkSystems(e);
  for (const p of e.product.controllers) {
    assert(Object.values(p.populations).reduce((a, b) => a + b, 0) === p.replicas.length, "Replica lifecycle partition");
    assert(p.inService <= p.populations.ready!, "LB eligibility is a subset of process-ready replicas");
    for (const r of p.replicas) {
      assert((r.createdAt === null) === (r.state === "reserved"), "Identity creation ownership");
      if (r.readyAt !== null) { assert(r.createdAt !== null && r.readyAt >= r.createdAt, "Readiness causality"); const client = e.systems.clients.find((c) => c.replicas.some((a) => a.target === r.id)); assert(!!client?.replicas.find((a) => a.target === r.id && a.state === "running"), "Actual acquired artifact ownership before ready"); }
      const selects = e.network.trace.events.filter((t) => t.kind === "lb-selected" && t.detail === r.id); assert(selects.every((t) => r.readyAt !== null && t.at >= r.readyAt), "No routing before readiness");
      if (r.state === "terminated") { const compute = e.resources.find((s) => s.id === r.id)!; assert(!r.endpoint.alive && compute.queued + compute.serving + compute.waiting === 0, "Terminated compute releases owned work"); }
    }
  }
}
export function generatedCompilerCases(count = 2048) {
  let valid = 0, refused = 0; const digest = createHash("sha256"), codes: Record<string, number> = {};
  for (let id = 0; id < count; id++) {
    const f = productFixture({ max: 1 + id % 3, slots: 3 + id % 4, horizon: 40000, cpu: 100 + id % 2000 });
    f.design.workload.readWriteRatio = (id % 11) / 10;
    if (id % 7 === 0) { const omitted = new Set(["cdn", "queue"]); f.design.resources = f.design.resources.filter((r) => !omitted.has(r.id)); f.design.connections = f.design.connections.filter((e) => !omitted.has(e.sourceId) && !omitted.has(e.targetId)); for (const k of omitted) delete f.contract.nodes[k]; const kept = new Set(f.design.connections.map((e) => e.id)); for (const k of Object.keys(f.contract.edges)) if (!kept.has(k)) delete f.contract.edges[k]; f.contract.commands = f.contract.commands.filter((c) => !["$cdn", "$queue"].includes(c.target)); }
    const bad = id % 4 === 0;
    if (bad) switch (id % 24) {
      case 0: f.contract.application = undefined; break;
      case 4: delete f.contract.edges.route; break;
      case 8: f.contract.nodes.lb!.listeners = []; break;
      case 12: f.design.resources.find((r) => r.id === "vm")!.skuId = "unverified-sku"; break;
      case 16: delete f.design.workload.readWriteRatio; break;
      case 20: f.contract.nodes.vm!.securityReplacement = undefined as never; break;
    }
    const c = compileProduct(f.design, f.contract); assert(c.ok !== bad, `Compiler case ${id}: ${JSON.stringify(c.ok ? "unexpected acceptance" : c.diagnostics)}`);
    if (!c.ok) { refused++; for (const d of c.diagnostics) codes[d.code] = (codes[d.code] ?? 0) + 1; digest.update(JSON.stringify(c.diagnostics)); continue; }
    valid++;
    f.design.resources.reverse(); f.design.connections.reverse(); for (const r of f.design.resources) { r.x += id; r.y -= id; r.name = `label-${id}`; }
    const reordered = compileProduct(f.design, f.contract); assert(reordered.ok && hash(c.value) === hash(reordered.value), `Compiler order/layout drift ${id}`); digest.update(hash(c.value));
  }
  return { count, valid, refused, codes, hash: digest.digest("hex"), scope: "Generated compiler verification, no physical/provider calibration" };
}
export function generatedControllerCases(count = 2048) {
  const digest = createHash("sha256"); let replays = 0, created = 0, drain = 0, artifactFailures = 0, missing = 0;
  for (let id = 0; id < count; id++) {
    const horizon = id % 8 <= 1 ? 20000 : 6000, minimum = id % 13 === 0 ? 2 : 1, maximum = 2 + id % 2, f = productFixture({ slots: 3, min: minimum, max: maximum, horizon: 40000, cpu: 40 + id % 700 }), p = f.contract.nodes.vm!.controller!;
    f.contract.horizon = f.q.q("generated.horizon", horizon, "us"); f.contract.sampleInterval = f.q.q("generated.sample", 1000, "us"); f.contract.arrival = { start: f.q.q("generated.start", 2000, "us") };
    f.design.workload = { targetThroughput: 60000 * (1 + id % 4), throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: (id % 5) / 4, payloadSize: "light" };
    f.contract.commands = f.contract.commands.filter((c) => c.id !== "cdn" && c.id !== "publish");
    p.interval = f.q.q("generated.interval", 400 + id % 601, "us"); p.startup = f.q.q("generated.startup", 100 + id % 1500, "us"); p.provision = f.q.q("generated.provision", id % 1000, "us"); p.cooldown = f.q.q("generated.cooldown", id % 1000, "us"); p.drain = f.q.q("generated.drain", 100 + id % 500, "us"); p.retry = f.q.q("generated.retry", 500, "us"); p.downStabilization = f.q.q("generated.stabilize", id % 1500, "us");
    if (id % 4 === 0) p.signal = { kind: "observed-core-time", backend: "$monitor/backend", freshFor: f.q.q("generated.fresh", 300 + id % 4000, "us"), stale: "hold" };
    if (id % 11 === 0) p.provisionFailures = [1];
    p.target = f.q.q("generated.target", (30 + id % 51) / 100, "ratio"); f.design.resources.find((r) => r.id === "vm")!.autoscaling!.targetCpu = 30 + id % 51;
    if (id % 6 === 0) p.manual.push({ id: "generated-up", at: f.q.q("generated.up.at", 2000, "us"), desired: f.q.q("generated.up.desired", maximum, "count") }, { id: "generated-down", at: f.q.q("generated.down.at", 4500, "us"), desired: f.q.q("generated.down.desired", minimum, "count") });
    const image = f.contract.nodes.vm!.resources.find((r) => r.role === "image")!.config; if (image.kind === "artifact-client" && id % 2 === 0) image.initialLayers = [{ digest: `sha256:${"a".repeat(64)}`, bytes: f.q.q("generated.layer", 4096, "bytes") }];
    if (id % 3 === 0) f.contract.faults.push({ id: "generated-crash", kind: "Crash", target: id % 2 ? "registry" : "monitor", at: f.q.q("generated.crash.at", 3000, "us"), duration: f.q.q("generated.crash.duration", 2000, "us"), restart: f.q.q("generated.restart", 100, "us"), profile: "retain-logical-state/1" });
    if (id % 5 === 0) f.contract.faults.push({ id: "generated-delay", kind: "NetworkDelay", target: "lb", scope: ["external-entry/request"], at: f.q.q("generated.delay.at", 2500, "us"), duration: f.q.q("generated.delay.duration", 1500, "us"), delay: f.q.q("generated.delay", 100 + id % 1000, "us") });
    const c = compileProduct(f.design, f.contract); assert(c.ok, `Controller case ${id} compile refusal: ${JSON.stringify(c.diagnostics)}`); if (!c.ok) continue;
    const r = createProductModel2(c.value); r.advanceTo(3500); checkProduct(r.evidence()); r.advanceTo(r.horizon); const e = r.evidence(); checkProduct(e);
    assert(e.capture.failure === null, `Controller runtime ${id}`); const pool = e.product.controllers[0]!;
    created += pool.replicas.filter((r) => r.createdAt !== null).length; drain += pool.events.filter((r) => r.kind === "draining").length; artifactFailures += pool.events.filter((r) => r.kind === "artifact-failed").length; missing += pool.missingMeasurements;
    if (id % 128 === 0) { const again = createProductModel2(c.value); again.advanceTo(1001); again.advanceTo(4777); again.advanceTo(again.horizon); assert(hash(e) === hash(again.evidence()), `Controller replay drift ${id}`); replays++; }
    digest.update(hash({ counts: e.counts, controllers: e.product.controllers, execution: e.execution }));
  }
  return { count, replays, created, drain, artifactFailures, missing, hash: digest.digest("hex"), scope: "Synthetic deterministic verification of actual compiler/M2C/M2D/M2G composition; not Kubernetes/AWS or physical calibration" };
}
