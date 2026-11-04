import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";

export function scalingSessionInput(maxReplicas: number) {
  const resources: Resource[] = [
    { id: "lb", type: "Load Balancer", x: 0, y: 0, lbHealth: { version: 1, intervalSeconds: 1, timeoutSeconds: 1 } },
    { id: "app", type: "Virtual Machine", size: "large", x: 0, y: 1,
      vmExecution: { version: 1, workers: 128, queuedRequests: 256 },
      autoscaling: { enabled: true, minReplicas: 1, maxReplicas, targetCpu: 1 } },
    { id: "db", type: "Database", skuId: "db.t3.micro", x: 0, y: 2, dbConcurrency: { version: 1, activeQueries: 1, queuedQueries: 256 } },
  ];
  const connectionLines = [["lb", "app"], ["app", "db"]].map(([s, t], i) => ({
    id: `e${i}`, sourceId: s!, targetId: t!, sourceType: resources.find(r => r.id === s)!.type,
    targetType: resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === t)!.type],
  }));
  const workload = { targetThroughput: 54000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 0, payloadSize: "light" as const };
  return readRunInputs(JSON.parse(JSON.stringify(captureRunInputs({ resources, connectionLines }, workload, "compiled-scaling"))));
}
