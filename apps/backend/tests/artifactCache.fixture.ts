import type { Resource } from "@infraforge/domain/resource";

export const artifactWorkload = {targetThroughput: 12000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const};
export function artifactLayout(capacityBytes?: number) {
  const resources: Resource[] = [
    {id: "lb", type: "Load Balancer", x: 0, y: 0, lbHealth: {version: 1, intervalSeconds: 1, timeoutSeconds: 1}},
    {id: "app", type: "Virtual Machine", size: "small", x: 256, y: 0, autoscaling: {enabled: true, minReplicas: 1, maxReplicas: 2, targetCpu: 50},
      ...(capacityBytes === undefined ? {} : {artifactCachePolicy: {version: 1 as const, capacityBytes}})},
  ];
  return {resources, connectionLines: [{id: "lb-app", sourceId: "lb", sourceType: "Load Balancer" as const, targetId: "app", targetType: "Virtual Machine" as const, port: 80}]};
}
