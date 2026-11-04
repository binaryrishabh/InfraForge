import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
export const gatewayWorkload = { targetThroughput: 600, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 0.5, payloadSize: "light" as const };
export function gatewayLayout(burstRequests = 1) {
  const resources: Resource[] = [{ id: "gateway", type: "API Gateway", x: 0, y: 0, apiGateway: { version: 1, routes: [{ id: "read", edge: "reads", path: "/read", method: "GET", burstRequests, requestsPerSecond: 1 }, { id: "write", edge: "writes", path: "/write", method: "POST", burstRequests: 100, requestsPerSecond: 100 }] } }, { id: "readApp", type: "Virtual Machine", x: 0, y: 0 }, { id: "writeApp", type: "Virtual Machine", x: 0, y: 0 }];
  return { resources, connectionLines: resources.slice(1).map((r, i) => ({ id: i ? "writes" : "reads", sourceId: "gateway", sourceType: resources[0]!.type, targetId: r.id, targetType: r.type, port: RESOURCE_PORTS[r.type] })) };
}
