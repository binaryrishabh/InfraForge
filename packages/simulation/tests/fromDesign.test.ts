import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { validateLedger } from "../src/reality/ledger";
import { CHALLENGE_VERSIONS } from "../../../apps/backend/challenges/definitions";

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
