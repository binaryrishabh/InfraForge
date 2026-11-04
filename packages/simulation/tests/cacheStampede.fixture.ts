import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline } from "../src/model2/product/timeline";
import { prepareKeyspace } from "./keyspace.fixture";

export function cacheStampede(options: { singleFlight?: boolean; ttlSeconds?: number; capacityEntries?: number; keys?: number; crash?: boolean } = {}) {
  const resources: Resource[] = [
    { id: "lb", type: "Load Balancer", x: 0, y: 0 },
    ...[0, 1, 2].map(i => ({ id: `app${i}`, type: "Virtual Machine" as const, x: i, y: 1, size: "large" as const })),
    { id: "cache", type: "Cache", x: 0, y: 2, cachePolicy: { version: 2, singleFlight: options.singleFlight ?? false, ttlSeconds: options.ttlSeconds ?? 1, capacityEntries: options.capacityEntries ?? 16 } },
    { id: "db", type: "Database", x: 0, y: 3, dataKeyspace: { version: 1, count: options.keys ?? 1 }, dbConcurrency: { version: 1, activeQueries: 1, queuedQueries: 128 } },
  ];
  const links = [...[0, 1, 2].flatMap(i => [["lb", `app${i}`], [`app${i}`, "cache"]]), ["cache", "db"]];
  const design: SavedProductDesign = {
    schema: "infraforge-saved-design/1", resources,
    connections: links.map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: resources.find(r => r.id === s)!.type, targetType: resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === t)!.type] })),
    workload: { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" },
  };
  const adapted = prepareKeyspace(design, "stampede-proof");
  let contract = withRunLength(adapted.contract, 7, "stampede-proof");
  if (options.crash) contract = withTimeline(contract, [{ id: "cache-down", kind: "crash", node: "cache", atUs: 1000000, durationUs: 1000000, restartUs: 1000 }]);
  const compiled = compileProduct(design, contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  // Same simultaneous requests at cold, warm, expired and post-restart boundaries.
  compiled.value.input.arrivals = [{ id: "bursts", kind: "trace", trace: {
    schema: "infraforge-arrivals/1", unit: "us", durationUs: 7000000,
    provenance: "Authored concurrency scenario; no provider performance claim",
    rows: Array.from({ length: 144 }, (_, i) => ({ id: String(i), atUs: [10000, 500000, 1500000, 2500000, 4000000, 5500000][Math.floor(i / 24)]!, operation: "read" })),
  } }];
  return { design, contract, compiled: compiled.value, runtime: createProductModel2(compiled.value) };
}

export function observeStampede(f: ReturnType<typeof cacheStampede>) {
  const rows = [100000, 600000, 1600000, 2600000, 4100000, 5600000, 7000000].map(at => {
    f.runtime.advanceTo(at);
    const e = f.runtime.evidence();
    return { at, reads: e.data.databases[0]!.logicalReads, sessions: e.data.databases[0]!.sessions.total, fills: e.data.caches[0]!.fills, completed: e.counts.completed };
  });
  const evidence = f.runtime.evidence();
  const completed = evidence.results.filter(r => r.outcome === "completed").map(r => r.responseUs).sort((a, b) => a - b);
  return { rows, evidence, completedP95Us: completed[Math.ceil(completed.length * 0.95) - 1]! };
}
