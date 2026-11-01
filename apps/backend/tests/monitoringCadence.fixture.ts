import { RESOURCE_PORTS, type Resource, type MonitoringPolicy } from "@infraforge/domain/resource";

export const monitoringWorkload = { targetThroughput: 120, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 0.8, payloadSize: "light" as const };
export function monitoringLayout(policy?: MonitoringPolicy, multiple = false) {
  const resources: Resource[] = [{ id: "vm", type: "Virtual Machine", x: 0, y: 0 }, { id: "monitor", type: "Monitoring Agent", x: 1, y: 0, ...(policy ? { monitoringPolicy: policy } : {}) }, ...(multiple ? [{ id: "db", type: "Database" as const, x: 2, y: 0 }] : [])];
  return { resources, connectionLines: [["monitor", "vm"], ...(multiple ? [["vm", "db"], ["monitor", "db"]] : [])].map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: resources.find(r => r.id === s)!.type, targetType: resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === t)!.type] })) };
}
