import type { Resource } from "@infraforge/domain/resource";
import type { ConnectionLine } from "@infraforge/domain/resource";
import type { WorkloadProfile } from "@infraforge/domain/workload";

export const seed = { text: "migration-baseline", engine: 1918722716 };
export const workload: WorkloadProfile = {
  targetThroughput: 500000,
  throughputUnit: "per-hour",
  trafficShape: "steady",
  readWriteRatio: 0.8,
  payloadSize: "medium",
};

export const layout: { resources: Resource[]; connectionLines: ConnectionLine[] } = {
  resources: [
    { id: "dns", type: "DNS", x: 0, y: 0 },
    { id: "lb", type: "Load Balancer", x: 200, y: 0, autoscaling: { minReplicas: 2, maxReplicas: 3, targetCpu: 95 } },
    { id: "vm-a", type: "Virtual Machine", x: 400, y: 0, skuId: "m5.large" },
    { id: "vm-b", type: "Virtual Machine", x: 400, y: 200, skuId: "m5.large" },
    { id: "db", type: "Database", x: 600, y: 0, skuId: "db.m5.large", public: true },
  ],
  connectionLines: [
    { id: "dns-lb", sourceId: "dns", targetId: "lb", sourceType: "DNS", targetType: "Load Balancer", port: 443 },
    { id: "lb-a", sourceId: "lb", targetId: "vm-a", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
    { id: "lb-b", sourceId: "lb", targetId: "vm-b", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
    { id: "a-db", sourceId: "vm-a", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 },
    { id: "b-db", sourceId: "vm-b", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 },
  ],
};
