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
