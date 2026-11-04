import type { SavedProductDesign } from "../src/model2/product/contracts";
export function functionDesign(concurrency = 16): SavedProductDesign {
  return { schema: "infraforge-saved-design/1", resources: [{ id: "fn", type: "Serverless Function", x: 0, y: 0, serverless: { version: 1, concurrency, initializationMs: 10, durationMs: 100, timeoutMs: 2000 } }, { id: "db", type: "Database", x: 200, y: 0 }], connections: [{ id: "query", sourceId: "fn", targetId: "db", sourceType: "Serverless Function", targetType: "Database", port: 5432 }], workload: { targetThroughput: 180000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" } };
}
