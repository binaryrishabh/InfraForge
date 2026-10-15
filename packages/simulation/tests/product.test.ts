import { expect, test } from "bun:test";
import { productFixture } from "./productFixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { presentModel2 } from "../src/model2/product/presentation";
import { TRANSLATION_OWNERS } from "../src/model2/product/owners";
import { CHAOS_COMPATIBILITY } from "../src/model2/product/faults";
import { requireKnown } from "../src/reality/quantity";
import { validateLedger } from "../src/reality/ledger";
import { resolveModel } from "../src/model2/registry";
function compiled(options: Parameters<typeof productFixture>[0] = {}) { const f = productFixture(options), c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics)); return { ...f, compiled: c.value }; }
test("same saved Resource/ConnectionLine/Workload objects compile all eleven mechanisms and run actual evidence", () => {
  const f = compiled(), r = createProductModel2(f.compiled); r.advanceTo(r.horizon); const e = r.evidence();
  expect(f.compiled.semantic.nodes).toHaveLength(11); expect(Object.keys(TRANSLATION_OWNERS)).toHaveLength(11);
  expect(e.counts.offered).toBeGreaterThan(100); expect(e.counts.completed).toBeGreaterThan(0);
  expect(e.systems.resolvers[0]!.authoritativeLookups).toBeGreaterThan(0);
  expect(e.systems.cdns[0]!.originRequests).toBeGreaterThan(0);
  expect(e.systems.registries[0]!.blobs.length).toBe(1);
  expect(e.asynchronous.brokers[0]!.accepted).toBe(1);
  expect(e.data.databases[0]!.transactions.committed).toBeGreaterThan(0);
  expect(e.data.caches[0]!.hits).toBeGreaterThan(0);
  expect(e.systems.backends[0]!.samples.length).toBeGreaterThan(0);
  expect(e.network.loadBalancers[0]!.attempts).toBeGreaterThan(0);
  expect(e.systems.security).toBeDefined(); expect(validateLedger(f.compiled.input.ledger)).toEqual([]);
});
test("layout, labels and saved resource/edge ordering cannot change compiled physics or run evidence", () => {
  const f = compiled({ horizon: 100000 }), design = structuredClone(f.design);
  design.resources.reverse(); design.connections.reverse(); for (const r of design.resources) { r.x += 170; r.y = -100; r.name = `Renamed ${r.id}`; }
  f.contract.application!.operations.reverse(); f.contract.application!.demands.reverse(); f.contract.ledger.reverse();
  const result = compileProduct(design, f.contract); expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.value).toEqual(f.compiled);
  const a = createProductModel2(f.compiled), b = createProductModel2(result.value); a.advanceTo(a.horizon); b.advanceTo(b.horizon); expect(a.evidence()).toEqual(b.evidence());
});
test("missing application, semantic edges, workers, transport demand and security replacement fail explicitly", () => {
  const mutations = [
    (f: ReturnType<typeof productFixture>) => { f.contract.application = undefined; },
    (f: ReturnType<typeof productFixture>) => { delete f.contract.edges.route; },
    (f: ReturnType<typeof productFixture>) => { f.contract.nodes.vm!.securityReplacement = undefined as never; },
    (f: ReturnType<typeof productFixture>) => { const r = f.contract.nodes.vm!.resources[0]!.config; if (r.kind === "compute") r.workers = { kind: "unknown", unit: "count", provenance: ["missing"], reason: "No application workers" }; },
    (f: ReturnType<typeof productFixture>) => { f.contract.transports.lab!.links[0]!.bandwidth = { kind: "unknown", unit: "bytes/s", provenance: ["missing"], reason: "Drawing does not establish bandwidth" }; },
  ];
  for (const mutate of mutations) { const f = productFixture(); mutate(f); const c = compileProduct(f.design, f.contract); expect(c.ok).toBe(false); expect(c.diagnostics[0]!.code).not.toBe("INVALID_DESIGN"); expect(c.diagnostics[0]!.message.length).toBeGreaterThan(10); }
});
test("legacy security/size/region cannot silently become future physics", () => {
  const f = compiled(), design = structuredClone(f.design); for (const r of design.resources) { r.public = true; r.encryption = true; r.openPorts = [22, 443]; r.size = "large"; r.region = "unverified-region"; }
  const c = compileProduct(design, f.contract); expect(c.ok).toBe(true); if (!c.ok) return;
  expect(c.value.input).toEqual(f.compiled.input); expect(c.value.semantic.legacyMetadata[0]!.encryption).toBe(true);
  expect(JSON.stringify(c.value.input)).not.toContain("unverified-region");
});
test("workload mixture needs explicit operations, payload bytes and peak window; no service-demand defaults", () => {
  for (const kind of ["mixture", "peak", "payload", "operation"] as const) { const f = productFixture(); if (kind === "mixture") delete f.design.workload.readWriteRatio; if (kind === "peak") delete f.contract.arrival.peak; if (kind === "payload") f.contract.application!.payloads.light = f.q.q("bad.bytes", 999, "bytes"); if (kind === "operation") f.contract.application!.readOperation = "unknown-query"; expect(compileProduct(f.design, f.contract).ok).toBe(false); }
  const f = compiled(); const trace = f.compiled.input.arrivals[0]!; expect(trace.kind).toBe("trace"); if (trace.kind === "trace") expect(new Set(trace.trace.rows.map((r) => r.operation))).toEqual(new Set(["read"]));
});
test("desired count never instantly becomes ready/LB-eligible; registry layers and startup precede traffic", () => {
  const f = compiled(), r = createProductModel2(f.compiled); r.advanceTo(60510); const mid = r.evidence(), p = mid.product.controllers[0]!;
  expect(p.desired).toBeGreaterThan(p.inService); expect(p.replicas[1]!.readyAt).toBeNull();
  expect(mid.network.loadBalancers[0]!.backends.find((b) => b.id === "vm#1")!.selected).toBe(0);
  r.advanceTo(r.horizon); const e = r.evidence(), events = e.product.controllers[0]!.events, acquired = events.find((x) => x.kind === "artifacts-acquired" && x.id === "vm#1")!, ready = events.find((x) => x.kind === "readiness" && x.id === "vm#1")!;
  expect(ready.at).toBe(acquired.at + 1000); expect(e.network.loadBalancers[0]!.backends.find((b) => b.id === "vm#1")!.selected).toBeGreaterThan(0);
  const drain = events.find((x) => x.kind === "draining")!, terminated = events.find((x) => x.kind === "terminated")!; expect(terminated.at).toBeGreaterThanOrEqual(drain.at);
  expect(e.product.controllers[0]!.populations.terminated).toBeGreaterThan(0);
});
test("registry outage blocks actual scale-out while the existing replica serves; retry recovers missing layers", () => {
  const f = compiled({ registryOutage: true }), r = createProductModel2(f.compiled); r.advanceTo(80000); const mid = r.evidence(), p = mid.product.controllers[0]!;
  expect(p.desired).toBeGreaterThan(p.inService); expect(p.replicas[0]!.state).toBe("ready"); expect(p.replicas[1]!.readyAt).toBeNull(); expect(mid.counts.completed).toBeGreaterThan(0);
  expect(mid.systems.clients.find((c) => c.id === "vm#1/image")!.failures).toBeGreaterThan(0);
  r.advanceTo(r.horizon); const recovered = r.evidence().product.controllers[0]!.replicas[1]!; expect(recovered.readyAt!).toBeGreaterThan(90000); expect(recovered.attempts).toBeGreaterThan(1);
});
test("observed controller holds on stale/missing backend evidence while application CPU keeps evolving", () => {
  const f = compiled({ observed: true, monitorOutage: true }), r = createProductModel2(f.compiled); r.advanceTo(60000); const before = r.evidence(); r.advanceTo(80000); const stale = r.evidence();
  expect(stale.product.controllers[0]!.desired).toBe(before.product.controllers[0]!.desired);
  expect(stale.product.controllers[0]!.missingMeasurements).toBeGreaterThan(before.product.controllers[0]!.missingMeasurements);
  expect(stale.resources.find((r) => r.id === "vm#0")!.consumedCoreUs).toBeGreaterThan(before.resources.find((r) => r.id === "vm#0")!.consumedCoreUs);
  const retained = stale.systems.backends[0]!.samples; expect(retained.some((s) => s.measurementAt > 45000 && s.measurementAt < 80000)).toBe(false);
  r.advanceTo(r.horizon); expect(r.evidence().systems.backends[0]!.samples.some((s) => s.measurementAt > 95000)).toBe(true);
});
test("manual desired capacity drains actual active work and terminates within authored grace", () => {
  const f = productFixture(); f.contract.nodes.vm!.controller!.manual.push({ id: "down", at: f.q.q("manual.at", 75000, "us"), desired: f.q.q("manual.desired", 1, "count") }); const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c)); const r = createProductModel2(c.value); r.advanceTo(75000); const start = r.evidence();
  expect(start.product.controllers[0]!.events.some((e) => e.kind === "manual-desired")).toBe(true);
  expect(start.network.loadBalancers[0]!.backends.find((b) => b.id === "vm#1")!.draining).toBe(true);
  r.advanceTo(85000); expect(r.evidence().product.controllers[0]!.replicas[1]!.state).toBe("terminated");
});
test("unsupported memory/disk and managed-resource CPU chaos stay unavailable; CPU spike owns real core-time", () => {
  expect(Object.keys(CHAOS_COMPATIBILITY)).toHaveLength(11);
  for (const kind of ["MemoryLeak", "DiskFailure", "CpuSpike"] as const) { const f = productFixture(); f.contract.faults.push({ id: "bad", kind, target: "db", at: f.q.q("bad.at", 40000, "us"), duration: f.q.q("bad.duration", 1000, "us"), cpu: f.q.q("bad.cpu", 1000, "cpu-us"), parallelism: f.q.q("bad.parallel", 1, "cores") }); expect(compileProduct(f.design, f.contract).ok).toBe(false); }
  const f = productFixture(); f.contract.faults.push({ id: "spike", kind: "CpuSpike", target: "vm", at: f.q.q("spike.at", 20000, "us"), duration: f.q.q("spike.duration", 10000, "us"), cpu: f.q.q("spike.cpu", 10000, "cpu-us"), parallelism: f.q.q("spike.parallel", 1, "cores") }); const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c)); const r = createProductModel2(c.value); r.advanceTo(30000); expect(r.evidence().resources.find((r) => r.id === "vm#0")!.compute!.cpu.competitorCoreUs).toBeGreaterThan(0);
});
test("presentation carries actual units/evidence and Unknown without a zero/cost fallback", () => {
  const f = compiled(), r = createProductModel2(f.compiled); r.advanceTo(20000); const e = r.evidence(), v = presentModel2(e);
  expect(v.values["cost.total"]!.kind).toBe("Unknown"); expect("value" in v.values["cost.total"]!).toBe(false);
  expect(v.values["cache.hits"]).toMatchObject({ kind: "Observed", unit: "count", value: e.data.caches[0]!.hits });
  expect(v.values["vm#0.cpu"]!.kind).toBe("Interpreted"); expect(v.values["vm#0.memory"]!.kind).toBe("Unknown");
});
test("unknown SKU facts refuse; numeric provenance and compiler versions are retained", () => {
  const f = compiled(); expect(f.compiled.semantic.numericOrigins.length).toBeGreaterThan(100); expect(f.compiled.semantic.versions.compiler).toBe("infraforge-product-compiler/1");
  f.design.resources.find((r) => r.id === "vm")!.skuId = "aws.ec2.t3.medium"; expect(compileProduct(f.design, f.contract).ok).toBe(false);
  const i = f.compiled.input; expect(requireKnown(i.horizon, "us")).toBe(250000); expect(i.ledger.every((e) => e.freeMode === "forbidden")).toBe(true);
});
test("a source-backed SKU capability is retained without changing application execution cores or throughput", () => {
  const f = compiled(), id = "m2h.fact.t3medium.vCpu", value = { kind: "known" as const, value: 2, unit: "count" as const, provenance: [id] };
  f.design.resources.find((r) => r.id === "vm")!.skuId = "t3.medium"; f.contract.catalogVersion = "2026-08";
  f.contract.ledger.push({ id, concept: "t3.medium vCpu count", modelVersion: "2", scope: "EC2 t3.medium advertised vCPU capability only", validityDomain: "EC2 general-purpose instance specification snapshot 2026-10-16; not effective CPU capacity or credit availability", quantity: value, formula: "Provider capability table", classification: "provider-fact", confidence: "high", provenance: [{ source: "https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html", supports: "exact", detail: "T3 medium lists 2 vCPUs; no workload throughput assertion" }], assumptions: ["Capability descriptor only; credit mode/balance/effective CPU remain independent"], researchedOn: "2026-10-16", freeMode: "forbidden", replacement: "Version source snapshot with M2I capability contracts" });
  f.contract.capabilities.push({ resource: "vm", sku: "t3.medium", catalogVersion: "2026-08", field: "vCpu", value, fact: id });
  const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c)); expect(c.value.semantic.capabilities[0]!.value).toEqual(value);
  const resource = c.value.input.resources.find((r) => r.id === "vm#0")!; if (resource.kind !== "compute") throw Error("Missing compiled compute"); expect(requireKnown(resource.cores, "cores")).toBe(1);
  const before = f.compiled.input.arrivals; expect(c.value.input.arrivals).toEqual(before);
});
test("resource-specific crashes retain or lose owned state and keep fault end separate from restart readiness", () => {
  for (const target of ["vm#0", "cache", "db", "queue", "objects", "dns", "dns/resolver", "cdn", "registry", "monitor"]) {
    const f = productFixture({ horizon: 40000 }); f.contract.faults.push({ id: "role-crash", kind: "Crash", target, at: f.q.q("role.crash.at", 10500, "us"), duration: f.q.q("role.crash.down", 5000, "us"), restart: f.q.q("role.crash.restart", 5000, "us"), profile: "retain-logical-state/1" });
    const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c)); const r = createProductModel2(c.value); r.advanceTo(15500); const end = r.evidence(); expect(end.network.endpoints[target]).toEqual({ alive: true, ready: false });
    if (target === "vm#0") expect(end.resources.find((s) => s.id === target)!.failed).toBeGreaterThan(0);
    if (target === "cache") expect(end.data.caches[0]!.entries).toHaveLength(0);
    if (target === "dns/resolver") expect(end.systems.resolvers[0]!.cache).toHaveLength(0);
    if (target === "cdn") expect(end.systems.cdns[0]!.entries).toHaveLength(0);
    if (target === "registry") expect(end.systems.registries[0]!.blobs).toHaveLength(1);
    if (target === "queue") expect(end.asynchronous.brokers[0]!.ready).toBe(1);
    r.advanceTo(20500); expect(r.evidence().network.endpoints[target]!.ready).toBe(true);
  }
}, 30000);
test("internal M2H dispatch and explicit warm layer ownership do not activate public Model 2", () => {
  expect(() => resolveModel("2", { workloadVersion: "m2h/1" })).toThrow("internal"); expect(resolveModel("1").published).toBe(true);
  const f = productFixture(); const image = f.contract.nodes.vm!.resources.find((r) => r.role === "image")!.config; if (image.kind !== "artifact-client") throw Error("Image role missing"); image.initialLayers = [{ digest: `sha256:${"a".repeat(64)}`, bytes: f.q.q("warm.layer", 4096, "bytes") }];
  const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c)); const model = resolveModel("2", { internal: true, workloadVersion: "m2h/1" }); if (model.workloadVersion !== "m2h/1") throw Error("Wrong model"); const r = model.create(c.value); r.advanceTo(10000); expect(r.evidence().systems.clients[0]!.pulledBytes).toBe(0); expect(r.evidence().systems.clients[0]!.reusedLayers).toBe(1);
});
test("unsupported settings, conflicting listeners and cyclic ingestion are diagnostic refusals", () => {
  const f = productFixture(); Object.assign(f.contract.nodes.vm!.resources[0]!.config, { magicRps: 9999 }); expect(compileProduct(f.design, f.contract).ok).toBe(false);
  const other = productFixture(); other.contract.nodes.lb!.listeners = []; const c = compileProduct(other.design, other.contract); expect(c.ok).toBe(false); expect(c.diagnostics[0]!.message).toContain("listener");
  Object.assign(other.contract, { cycle: other.contract }); expect(compileProduct(other.design, other.contract).ok).toBe(false);
});
test("fresh observed core-time can drive scaling with a slower evaluation interval than collection freshness", () => {
  const f = compiled({ observed: true }), r = createProductModel2(f.compiled); r.advanceTo(r.horizon);
  const events = r.evidence().product.controllers[0]!.events;
  expect(events.some((e) => e.kind === "desired" && e.detail === "2")).toBe(true);
  expect(events.some((e) => e.kind === "draining")).toBe(true);
});
test("explicit shared-link transport keeps one bottleneck owner across DNS bootstrap and application paths", () => {
  const f = productFixture({ horizon: 40000 }), t = structuredClone(f.contract.transports.lab!); t.ownership = "shared";
  const base = t.links[0]!;
  t.links = [
    { ...base, id: "out", from: "$caller", to: "fabric" }, { ...base, id: "lb", from: "fabric", to: "$lb" }, { ...base, id: "resolver", from: "fabric", to: "$dns/resolver" },
    { ...base, id: "in", from: "fabric", to: "$caller" }, { ...base, id: "lb-return", from: "$lb", to: "fabric" }, { ...base, id: "resolver-return", from: "$dns/resolver", to: "fabric" },
  ]; f.contract.transports.shared = t;
  Object.assign(f.contract.caller, { transport: "shared", request: ["out", "lb"], response: ["lb-return", "in"] });
  Object.assign(f.contract.caller.dependencies[0]!, { transport: "shared", request: ["out", "resolver"], response: ["resolver-return", "in"] });
  const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c));
  expect(c.value.input.links.filter((l) => l.id === "transport:shared/out")).toHaveLength(1);
  expect(c.value.input.paths.filter((p) => p.request.includes("transport:shared/out"))).toHaveLength(2);
  const r = createProductModel2(c.value); r.advanceTo(r.horizon); expect(r.evidence().counts.completed).toBeGreaterThan(0); expect(r.evidence().systems.resolvers[0]!.authoritativeLookups).toBeGreaterThan(0);
  expect(presentModel2(r.evidence()).values["vm#2.cpu"]!.kind).toBe("Unknown");
});
test("explicit node cache can be shared across replica lifecycles regardless of resource declaration order", () => {
  const f = productFixture(), image = structuredClone(f.contract.nodes.vm!.resources.find((r) => r.role === "image")!);
  f.design.resources.push({ id: "zzcache", type: "Container Registry", x: 0, y: 0 });
  f.contract.nodes.zzcache = { ...structuredClone(f.contract.nodes.registry!), resources: [...structuredClone(f.contract.nodes.registry!.resources), { ...image, role: "client" }], identities: [{ role: "main", zone: "internal", address: "203.0.113.1" }, { role: "client", zone: "internal", address: "203.0.113.2" }], listeners: [...structuredClone(f.contract.nodes.registry!.listeners), { ...structuredClone(f.contract.nodes.vm!.listeners.find((l) => l.role === "image")!), role: "client" }] };
  f.contract.nodes.vm!.controller!.artifact = { node: "zzcache", role: "client", reference: "release" };
  for (const [id, target, sourceRole, purpose] of [["zzstore", "objects", "main", "origin"], ["zzpull", "registry", "client", "artifact"]] as const) { f.design.connections.push({ id, sourceId: "zzcache", targetId: target, sourceType: "Container Registry", targetType: target === "objects" ? "Object Storage" : "Container Registry", port: 8080 }); f.contract.edges[id] = { ...structuredClone(f.contract.edges.store!), sourceRole, purpose }; }
  const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c)); const r = createProductModel2(c.value); r.advanceTo(r.horizon); const cache = r.evidence().systems.clients.find((c) => c.id === "zzcache/client")!;
  expect(cache.pulledBytes).toBe(4096); expect(cache.reusedLayers).toBeGreaterThan(0); expect(cache.replicas.filter((r) => r.state === "running").length).toBeGreaterThan(1);
});
