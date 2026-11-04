import type { Resource } from "@infraforge/domain/resource";
export const functionWorkload = { targetThroughput: 600, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
export function functionLayout() {
  return { resources: [{ id: "fn", type: "Serverless Function", x: 0, y: 0, serverless: { version: 1, concurrency: 4, initializationMs: 100, durationMs: 100, timeoutMs: 1000, idleExpiryMs: 150 } }, { id: "db", type: "Database", x: 200, y: 0 }] as Resource[], connectionLines: [{ id: "query", sourceId: "fn", targetId: "db", sourceType: "Serverless Function" as const, targetType: "Database" as const, port: 5432 }] };
}
