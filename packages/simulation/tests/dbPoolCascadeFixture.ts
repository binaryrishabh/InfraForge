import { contractFromDesign } from "../src/model2/product/fromDesign";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline } from "../src/model2/product/timeline";
import { compileProduct } from "../src/model2/product/compiler";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { quantities } from "./workloadFixture";

// Authored slow-query test, not a provider performance claim. Canvas deadlines remain 1s / 2s.
export function dbPoolCascade() {
  const resources: SavedProductDesign["resources"] = [
    { id: "lb", type: "Load Balancer", name: "LB", x: 0, y: 0 },
    { id: "app", type: "Virtual Machine", name: "App", x: 1, y: 0, autoscaling: { enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 1 } },
    { id: "cache", type: "Cache", name: "Cache", x: 2, y: 0 },
    { id: "db", type: "Database", name: "DB", x: 3, y: 0 },
  ];
  const design: SavedProductDesign = { schema: "infraforge-saved-design/1", resources,
    connections: [["lb", "app"], ["app", "cache"], ["app", "db"]].map(([sourceId, targetId], i) => ({ id: `edge${i}`, sourceId: sourceId!, targetId: targetId!, sourceType: resources.find(r => r.id === sourceId)!.type, targetType: resources.find(r => r.id === targetId)!.type, port: targetId === "db" ? 5432 : targetId === "cache" ? 6379 : 80 })),
    workload: { targetThroughput: 7200, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light" } };
  const result = contractFromDesign(design); if ("refused" in result) throw Error(JSON.stringify(result.refused));
  let contract = withRunLength(result.contract, 45, "db-pool-cascade");
  const q = quantities("Authored slow read (50ms CPU), 12 database sessions, 128 app workers; test scope only");
  const db = contract.nodes.db!.resources[0]!.config; if (db.kind !== "relational") throw Error("expected DB");
  db.maxSessions = q.q("cascade.sessions", 12, "count"); db.activeTransactions = q.q("cascade.active", 2, "count");
  for (const [op, plan] of Object.entries(db.plans)) plan.statements[0]!.cpu = q.q(`cascade.${op}.cpu`, 50000, "cpu-us");
  for (const role of contract.nodes.app!.resources) {
    if (role.config.kind === "compute") role.config.workers = q.q(`cascade.${role.role}.workers`, 128, "count");
    if (role.config.kind === "cache-aside") role.config.execution.workers = q.q(`cascade.${role.role}.workers`, 128, "count");
  }
  const cache = contract.nodes.cache!.resources[0]!.config;
  if (cache.kind === "cache") cache.initial = [{ key: "key", version: 1, bytes: q.q("cascade.warm.row", 1024, "bytes") }];
  const lb = contract.nodes.lb!.resources[0]!.config;
  if (lb.kind === "load-balancer") lb.health.unhealthy = q.q("cascade.unhealthy.observations", 100, "count");
  contract.commands.push({ id: "warmup-query", source: "$app#0/aside", target: "$db", at: q.q("cascade.warmup.at", 1000000, "us"), operation: "read", request: { kind: "query", key: "key" }, bodyBytes: q.q("cascade.warmup.bytes", 0, "bytes"), provenance: "One authored warm-up query establishes the pre-fault session baseline." });
  contract.ledger.push(...q.ledger);
  contract = withTimeline(contract, [{ id: "cache-failure", kind: "crash", node: "cache", atUs: 5_000_000, durationUs: 19_000_000, restartUs: 1000 }]);
  const compiled = compileProduct(design, contract); if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return { design, contract, compiled: compiled.value };
}


