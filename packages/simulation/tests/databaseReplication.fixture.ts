import { relationalDatabase } from "../src/model2/data/database";
import { EventKernel } from "../src/model2/time";
import type { RelationalConfig } from "../src/model2/data/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import { dataFixture } from "./dataFixture";
import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { prepareKeyspace } from "./keyspace.fixture";

export const historicalDatabaseModes = ["plain", "cache", "hot-key", "lb-vm"] as const;
export function databaseDesign(mode: typeof historicalDatabaseModes[number] = "plain"): SavedProductDesign {
  const types: Resource["type"][] = mode === "plain" ? ["Virtual Machine", "Database"] : mode === "lb-vm" ? ["Load Balancer", "Virtual Machine", "Database"] : ["Virtual Machine", "Cache", "Database"];
  const resources: Resource[] = types.map((type, i) => ({ id: type === "Database" ? "db" : `node-${i}`, type, x: i, y: 0 }));
  if (mode === "hot-key") resources.at(-1)!.dataKeyspace = { version: 1, count: 10, accessPattern: "hot-key" };
  return { schema: "infraforge-saved-design/1", resources,
    connections: resources.slice(1).map((r, i) => ({ id: `edge-${i}`, sourceId: resources[i]!.id, sourceType: resources[i]!.type, targetId: r.id, targetType: r.type, port: RESOURCE_PORTS[r.type] })),
    workload: { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" } };
}
export const prepareDatabase = (design = databaseDesign()) => prepareKeyspace(design, "database-ha-proof");

export function replicaFixture(delay = 2, policy: "primary" | "replica-preferred" = "primary") {
  const config = dataFixture({ dbCpu: 100 }).resources.find(r => r.kind === "relational") as RelationalConfig;
  config.replication = { version: 1, enabled: true, replicationDelayMs: delay, readPolicy: policy };
  const clock = new EventKernel(10000), db = relationalDatabase(config, clock);
  let sequence = 0;
  const submit = (operation = "heavy", key = "k0") => {
    const id = `work-${sequence++}`;
    const work: Invocation = { rootId: id, callId: id, sessionId: id, operation, attempt: 0, offeredAt: clock.now, message: { request: { kind: "query", key } } };
    db.accept(work, () => db.closeSession(id)); return work;
  };
  return { config, clock, db, submit, ha: () => db.evidence().databaseReplication! };
}
