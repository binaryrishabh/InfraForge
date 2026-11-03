import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
export function gatewayDesign(burstRequests = 1): SavedProductDesign {
  const resources: Resource[] = [{ id: "gateway", type: "API Gateway" as Resource["type"], x: 0, y: 0, apiGateway: { version: 1, routes: [{ id: "read", edge: "reads", path: "/read", method: "GET", burstRequests, requestsPerSecond: 1 }, { id: "write", edge: "writes", path: "/write", method: "POST", burstRequests: 100, requestsPerSecond: 100 }] } }, { id: "readApp", type: "Virtual Machine", x: 0, y: 0 }, { id: "writeApp", type: "Virtual Machine", x: 0, y: 0 }];
  return { schema: "infraforge-saved-design/1", resources, connections: resources.slice(1).map((r, i) => ({ id: i ? "writes" : "reads", sourceId: "gateway", sourceType: resources[0]!.type, targetId: r.id, targetType: r.type, port: RESOURCE_PORTS[r.type] })), workload: { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.5, payloadSize: "light" } };
}
