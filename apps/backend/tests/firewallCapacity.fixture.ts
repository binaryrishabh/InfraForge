import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";

export const firewallWorkload = { targetThroughput: 6000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
export function firewallLayout(maxFlows?: number, two = false) {
  const resources: Resource[] = [{ id: "lb", type: "Load Balancer", x: 0, y: 0 }, { id: "app", type: "Virtual Machine", x: 0, y: 0 }, { id: "firewall", type: "Firewall", x: 0, y: 0, firewallSettings: { version: 1, default: "allow", rules: [] } }];
  if (maxFlows !== undefined) Object.assign(resources[2]!, { firewallCapacity: { version: 1, maxFlows } });
  if (two) resources.push({ id: "second", type: "Firewall", x: 0, y: 0, firewallSettings: { version: 1, default: "allow", rules: [] } });
  const links = [["lb", "app"], ["firewall", "lb"], ...(two ? [["second", "app"]] : [])];
  return { resources, connectionLines: links.map(([s, t], i) => ({ id: `edge-${i}`, sourceId: s!, targetId: t!, sourceType: resources.find(r => r.id === s)!.type, targetType: resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === t)!.type] })) };
}
