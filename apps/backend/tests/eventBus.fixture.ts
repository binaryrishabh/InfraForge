import { RESOURCE_PORTS } from "@infraforge/domain/resource";
import { capacityLayout, capacityWorkload } from "./queueCapacity.fixture";
export { capacityWorkload as eventBusWorkload };
export function eventBusLayout() {
  const d = capacityLayout();
  d.resources.push({ id: "bus", type: "Event Bus", x: 0, y: 0, eventBus: { version: 1, retryDelayMs: 100, maxAttempts: 3 } }, { ...structuredClone(d.resources[1]!), id: "queue2" }, { ...structuredClone(d.resources[2]!), id: "worker2" });
  d.connectionLines = [["app", "bus"], ["app", "store"], ["bus", "queue"], ["bus", "queue2"], ["queue", "worker"], ["queue2", "worker2"], ["worker", "store"], ["worker2", "store"]].map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: d.resources.find(r => r.id === s)!.type, targetType: d.resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[d.resources.find(r => r.id === t)!.type] }));
  return d;
}
