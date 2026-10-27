import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { validateLedger } from "../src/reality/ledger";
import { CHALLENGE_VERSIONS } from "../../../apps/backend/challenges/definitions";
import { CATALOG } from "@infraforge/catalog";
import { requireKnown } from "../src/reality/quantity";

function design(types: Record<string, Resource["type"]>, links: string[][] = []): SavedProductDesign {
  return { schema: "infraforge-saved-design/1", resources: Object.entries(types).map(([id, type]) => ({ id, type, x: 0, y: 0 })), connections: links.map(([s, t], i) => ({ id: `edge-${i}`, sourceId: s!, targetId: t!, sourceType: types[s!]!, targetType: types[t!]!, port: RESOURCE_PORTS[types[t!]!] })), workload: { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" } };
}
function prepare(d: SavedProductDesign) {
  const result = contractFromDesign(d);
  if ("refused" in result) throw Error(JSON.stringify(result.refused));
  const compiled = compileProduct(d, result.contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return { ...result, compiled: compiled.value };
}
const minimal: Array<[Resource["type"], SavedProductDesign]> = [
  ["Virtual Machine", design({ app: "Virtual Machine" })],
  ["Database", design({ app: "Virtual Machine", db: "Database" }, [["app", "db"]])],
  ["Cache", design({ app: "Virtual Machine", cache: "Cache", db: "Database" }, [["app", "cache"], ["cache", "db"]])],
  ["Load Balancer", design({ lb: "Load Balancer", app: "Virtual Machine" }, [["lb", "app"]])],
  ["DNS", design({ dns: "DNS", app: "Virtual Machine" }, [["dns", "app"]])],
  ["Firewall", design({ firewall: "Firewall", app: "Virtual Machine" }, [["firewall", "app"]])],
  ["Object Storage", design({ app: "Virtual Machine", store: "Object Storage" }, [["app", "store"]])],
  ["CDN", design({ cdn: "CDN", store: "Object Storage" }, [["cdn", "store"]])],
  ["Container Registry", design({ app: "Virtual Machine", registry: "Container Registry", store: "Object Storage" }, [["app", "registry"], ["registry", "store"]])],
  ["Message Queue", design({ app: "Virtual Machine", queue: "Message Queue" }, [["app", "queue"]])],
  ["Monitoring Agent", design({ monitor: "Monitoring Agent", app: "Virtual Machine" }, [["monitor", "app"]])],
];
for (const [type, d] of minimal) test(`${type}: minimal canvas compiles and runs ten seconds`, () => {
  const f = prepare(d), runtime = createProductModel2(f.compiled);
  runtime.advanceTo(10000000); const e = runtime.evidence();
  expect(e.counts.offered).toBeGreaterThanOrEqual(100);
  expect(e.counts.completed).toBeGreaterThan(0);
  expect(validateLedger(f.contract.ledger)).toEqual([]);
  if (type === "Cache") expect(e.data.caches[0]!.hits).toBeGreaterThan(0);
  if (type === "Database") expect(e.data.databases[0]!.transactions.committed).toBeGreaterThan(0);
  if (type === "CDN") expect(e.systems.cdns[0]!.originRequests).toBeGreaterThan(0);
  if (type === "Container Registry") expect(e.systems.registries[0]!.blobs.length).toBe(1);
  if (type === "Message Queue") expect(e.asynchronous.brokers[0]!.accepted).toBe(1);
  if (type === "DNS") expect(e.systems.resolvers[0]!.authoritativeLookups).toBeGreaterThan(0);
});

test("defaults and contract hashes are deterministic and do not depend on canvas layout", () => {
  const d = minimal[2]![1], before = structuredClone(d), a = prepare(d);
  const reordered = structuredClone(d); reordered.resources.reverse(); reordered.connections.reverse();
  for (const r of reordered.resources) { r.x = 123; r.y = -20; r.name = "Renamed"; }
  const b = prepare(reordered), hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v).replaceAll("\r\n", "\n")).digest("hex");
  expect(hash(a.contract)).toBe(hash(b.contract)); expect(a.assumptions).toEqual(b.assumptions); expect(d).toEqual(before);
  expect(new Set(a.assumptions.map((s) => s.id)).size).toBe(a.assumptions.length);
  expect(a.assumptions.every((s) => s.unit && s.sentence.endsWith(".") && s.value !== undefined)).toBe(true);
  for (const row of a.contract.ledger.filter((r) => r.classification === "educational-assumption")) expect(a.assumptions.find((s) => s.id === row.id)).toBeDefined();
});

test("load balancers serve immediately and retain five-second health checks", () => {
  const f = prepare(minimal[3]![1]), runtime = createProductModel2(f.compiled);
  runtime.advanceTo(1000000); expect(runtime.evidence().counts.completed).toBeGreaterThan(0);
  expect(f.assumptions.find((a) => a.id === "lb.health.interval")?.value).toBe(5000000);
  expect(f.assumptions.find((a) => a.id === "run.sampleInterval")?.value).toBe(1000000);
});

for (const challenge of CHALLENGE_VERSIONS) test(`challenge ${challenge.id}: actual starter at its workload for thirty seconds`, () => {
  const d: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: challenge.starter?.resources ?? [], connections: challenge.starter?.connectionLines ?? [], workload: challenge.workload };
  if (!challenge.starter) { expect(contractFromDesign(d)).toMatchObject({ refused: [{ path: "resources" }] }); return; }
  const f = prepare(d), runtime = createProductModel2(f.compiled);
  runtime.advanceTo(30000000); const e = runtime.evidence();
  expect(e.counts.offered).toBeGreaterThan(1000); expect(e.counts.completed).toBeGreaterThan(0);
  expect(f.contract.horizon).toMatchObject({ value: 30000000 });
}, 60000);

test("impossible wiring returns plain refusals", () => {
  for (const d of [design({}), design({ db: "Database" }), design({ lb: "Load Balancer" }), design({ a: "Virtual Machine", b: "Virtual Machine" }), design({ app: "Virtual Machine", cdn: "CDN" }, [["cdn", "app"]]), design({ app: "Virtual Machine", db: "Database" }, [["db", "app"]])]) {
    const result = contractFromDesign(d); expect("refused" in result).toBe(true);
    if ("refused" in result) expect(result.refused.every((d) => d.message.length > 20 && d.severity === "error")).toBe(true);
  }
});

test("separate app-to-cache and app-to-database connections execute cache-aside work", () => {
  const d = design({ app: "Virtual Machine", cache: "Cache", db: "Database" }, [["app", "cache"], ["app", "db"]]);
  const f = prepare(d), runtime = createProductModel2(f.compiled); runtime.advanceTo(10000000);
  expect(runtime.evidence().data.caches[0]!.hits).toBeGreaterThan(0);
  expect(runtime.evidence().data.databases[0]!.transactions.committed).toBeGreaterThan(0);
});

test("every catalog CPU and memory label sizes an explicitly assumed profile", () => {
  for (const sku of CATALOG) {
    const d = design({ app: "Virtual Machine", db: "Database" }, [["app", "db"]]);
    const r = d.resources.find((r) => r.type === sku.category)!; r.skuId = sku.skuId;
    const f = prepare(d), main = f.contract.nodes[r.id]!.resources.find((r) => r.role === "main")!.config;
    const execution = main.kind === "compute" ? main : main.kind === "relational" ? main.execution : undefined;
    expect(execution).toBeDefined(); expect(requireKnown(execution!.cores, "cores")).toBe(sku.vCpu);
    expect(f.assumptions.find((a) => a.id === `${r.id}.sizing`)?.value).toEqual({ cores: sku.vCpu, memoryGb: sku.ramGb });
    expect(f.contract.capabilities[0]!.value).toMatchObject({ value: sku.vCpu });
  }
  for (const [size, cores] of [["small", 1], ["medium", 2], ["large", 4]] as const) {
    const d = design({ app: "Virtual Machine" }); d.resources[0]!.size = size;
    expect(prepare(d).assumptions.find((a) => a.id === "app.main.cores")?.value).toBe(cores);
  }
});

test("monitoring collects and exports real observations every ten seconds", () => {
  const f = prepare(minimal[10]![1]), runtime = createProductModel2(f.compiled);
  runtime.advanceTo(21000000); const samples = runtime.evidence().systems.backends[0]!.samples;
  expect(samples.length).toBeGreaterThan(0);
  expect(samples.some((s) => s.measurementAt >= 10000000)).toBe(true);
  expect(f.assumptions.find((a) => a.id === "monitor.interval")?.value).toBe(10000000);
});

test("VM autoscaling provisions a real image before new replicas become ready", () => {
  const d = design({ lb: "Load Balancer", app: "Virtual Machine" }, [["lb", "app"]]);
  d.resources[1]!.autoscaling = { enabled: true, minReplicas: 1, maxReplicas: 2, targetCpu: 10 };
  d.workload.targetThroughput = 12000;
  const f = prepare(d), runtime = createProductModel2(f.compiled);
  runtime.advanceTo(1000000); expect(runtime.evidence().counts.completed).toBeGreaterThan(0);
  expect(runtime.evidence().product.controllers[0]!.replicas[0]!.readyAt).toBe(0);
  runtime.advanceTo(16000000);
  const e = runtime.evidence(), events = e.product.controllers[0]!.events;
  expect(e.counts.completed).toBeGreaterThan(0);
  const acquired = events.find((e) => e.id === "app#1" && e.kind === "artifacts-acquired");
  const ready = events.find((e) => e.id === "app#1" && e.kind === "readiness");
  expect(acquired).toBeDefined(); expect(ready).toBeDefined(); expect(ready!.at).toBeGreaterThan(acquired!.at);
}, 30000);

test("saved LB policies preserve total bounds without mutating the canvas", () => {
  const d = design({ lb: "Load Balancer", a: "Virtual Machine", b: "Virtual Machine" }, [["lb", "a"], ["lb", "b"]]);
  d.resources[0]!.autoscaling = { enabled: true, minReplicas: 2, maxReplicas: 4, targetCpu: 60 };
  const before = structuredClone(d), f = prepare(d), controller = f.contract.nodes.a!.controller!;
  expect(requireKnown(controller.min, "count") + 1).toBe(2); expect(requireKnown(controller.max, "count") + 1).toBe(4);
  expect(d).toEqual(before); expect(f.contract.nodes.b!.controller).toBeUndefined();
  const reordered = structuredClone(d); reordered.resources.reverse(); reordered.connections.reverse();
  expect(prepare(reordered).contract).toEqual(f.contract);
  // Compiler still refuses a contract that disagrees with the saved policy.
  controller.min = controller.max; expect(compileProduct(d, f.contract).ok).toBe(false);
});

test("autoscaling uses an explicitly drawn registry when available", () => {
  const d = design({ lb: "Load Balancer", app: "Virtual Machine", registry: "Container Registry", store: "Object Storage" }, [["lb", "app"], ["app", "registry"], ["registry", "store"]]);
  d.resources[1]!.autoscaling = { enabled: true, minReplicas: 1, maxReplicas: 2, targetCpu: 10 }; d.workload.targetThroughput = 12000;
  const f = prepare(d), runtime = createProductModel2(f.compiled); runtime.advanceTo(16000000);
  expect(f.contract.nodes.app!.resources.some((r) => r.role === "registry")).toBe(false);
  expect(runtime.evidence().systems.registries).toHaveLength(1);
  expect(runtime.evidence().product.controllers[0]!.replicas[1]!.readyAt).not.toBeNull();
});

test("disconnected services, bad IDs, missing endpoints, invalid workloads and malformed input refuse", () => {
  const disconnected = design({ app: "Virtual Machine", store: "Object Storage" });
  const sku = design({ app: "Virtual Machine" }); sku.resources[0]!.skuId = "unknown";
  const missing = design({ app: "Virtual Machine", db: "Database" }, [["app", "db"]]); missing.resources.pop();
  const duplicate = design({ app: "Virtual Machine" }); duplicate.resources.push({ ...duplicate.resources[0]! });
  const workload = design({ app: "Virtual Machine" }); workload.workload.targetThroughput = NaN;
  const cyclic = design({ app: "Virtual Machine" }); Object.assign(cyclic, { cycle: cyclic });
  for (const d of [disconnected, sku, missing, duplicate, workload, cyclic, null as unknown as SavedProductDesign]) expect("refused" in contractFromDesign(d)).toBe(true);
});
