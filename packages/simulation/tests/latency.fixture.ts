import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";

export function latencyDesign(retry = false, limited = false): SavedProductDesign {
  const resources: Resource[] = [
    { id: "lb", type: "Load Balancer", x: 0, y: 0, ...(limited ? { lbRateLimit: { version: 1 as const, burstRequests: 20, sustainedRequestsPerSecond: 200 } } : {}) },
    { id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 0 } },
    { id: "db", type: "Database", x: 2, y: 0 },
  ];
  return { schema: "infraforge-saved-design/1", resources,
    connections: [["lb", "app"], ["app", "db"]].map(([s, t], i) => ({ id: `edge-${i}`, sourceId: s!, targetId: t!, sourceType: resources.find(r => r.id === s)!.type, targetType: resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === t)!.type] })),
    workload: { targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light", ...(retry ? { clientRetry: { version: 1, maxAttempts: 3, backoffMs: 50 } } : {}) } };
}
