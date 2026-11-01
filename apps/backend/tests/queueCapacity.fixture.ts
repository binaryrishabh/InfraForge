import { DEFAULT_ASYNC_QUEUE_SETTINGS, DEFAULT_ASYNC_WORKER_SETTINGS, RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";

export const capacityWorkload = { targetThroughput: 480, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 0.8, payloadSize: "light" as const };
export function capacityLayout(capacityMessages?: number, publishFlow = false) {
  const resources: Resource[] = [
    { id: "app", type: "Virtual Machine", x: 0, y: 0 },
    { id: "queue", type: "Message Queue", x: 1, y: 0, asyncQueue: { ...DEFAULT_ASYNC_QUEUE_SETTINGS, ...(capacityMessages === undefined ? {} : { capacityMessages }) } },
    { id: "worker", type: "Virtual Machine", x: 2, y: 0, asyncWorker: { ...DEFAULT_ASYNC_WORKER_SETTINGS } },
    { id: "store", type: "Object Storage", x: 1, y: 1 },
  ];
  if (publishFlow) resources[0]!.applicationFlow = { schema: "application-flow/3", operations: { write: { steps: [{ id: "cpu", kind: "compute" }, { id: "send", kind: "publish", edge: "e0" }] } } };
  return { resources, connectionLines: [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]].map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: resources.find(r => r.id === s)!.type, targetType: resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === t)!.type] })) };
}
