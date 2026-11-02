import type { Resource } from "@infraforge/domain/resource";
export function databaseLayout(delay = 2000, readPolicy: "primary" | "replica-preferred" = "replica-preferred") {
  const resources: Resource[] = [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }, { id: "db", type: "Database", x: 1, y: 0,
    dataKeyspace: { version: 1, count: 10, accessPattern: "hot-key" }, databaseReplication: { version: 1, enabled: true, replicationDelayMs: delay, readPolicy } }];
  return { resources, connectionLines: [{ id: "app-db", sourceId: "app", sourceType: "Virtual Machine", targetId: "db", targetType: "Database", port: 5432 }] };
}
export const databaseWorkload = { targetThroughput: 600, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 0.5, payloadSize: "light" as const };
export const promoteRequest = { kind: "intervention" as const, parameters: { interventionId: "db-promote-replica", revision: 1, target: { resourceId: "db" }, parameters: {} } };
