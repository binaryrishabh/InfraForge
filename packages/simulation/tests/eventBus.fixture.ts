import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import { design } from "./asyncCanvas.fixture";
export function eventBusDesign() {
  const d = design(true, 2);
  d.resources.push({ id: "bus", type: "Event Bus", x: 0, y: 0, eventBus: { version: 1, retryDelayMs: 100, maxAttempts: 3 } });
  d.resources.push({ ...structuredClone(d.resources.find(r => r.id === "queue")!), id: "queue2" }, { ...structuredClone(d.resources.find(r => r.id === "worker")!), id: "worker2" });
  const types = new Map(d.resources.map(r => [r.id, r.type]));
  d.connections = [["app", "bus"], ["app", "store"], ["bus", "queue"], ["bus", "queue2"], ["queue", "worker"], ["queue2", "worker2"], ["worker", "store"], ["worker2", "store"]].map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: types.get(s!) as Resource["type"], targetType: types.get(t!) as Resource["type"], port: RESOURCE_PORTS[types.get(t!)!] }));
  return d;
}
