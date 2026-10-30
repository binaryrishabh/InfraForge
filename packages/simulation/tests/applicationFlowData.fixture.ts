import type { SavedProductDesign } from "../src/model2/product/contracts";

export function canvasDataFlow(cache = false): SavedProductDesign {
  return { schema: "infraforge-saved-design/1", resources: [
    { id: "app", type: "Virtual Machine", x: 0, y: 0, applicationFlow: { schema: "application-flow/2", operations: {
      read: { steps: [{ id: "cpu", kind: "compute" }, { id: "read-data", kind: "data", edge: cache ? "app-cache" : "app-db", operation: "read" }] },
      write: { steps: [{ id: "write-data", kind: "data", edge: cache ? "app-cache" : "app-db", operation: "write" }] },
    } } },
    { id: "db", type: "Database", x: 1, y: 0 },
    ...(cache ? [{ id: "cache", type: "Cache" as const, x: 1, y: 1 }] : []),
  ], connections: [
    ...(!cache ? [{ id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 }] : []),
    ...(cache ? [
      { id: "app-cache", sourceId: "app", targetId: "cache", sourceType: "Virtual Machine", targetType: "Cache", port: 6379 },
      { id: "cache-db", sourceId: "cache", targetId: "db", sourceType: "Cache", targetType: "Database", port: 5432 },
    ] : []),
  ], workload: { targetThroughput: 60, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" } };
}
