import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
export const dnsWorkload = { targetThroughput: 120, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
export function dnsLayout(maxTtlSeconds?: number, mode: "vm" | "cdn" = "vm") {
  const resources: Resource[] = [{ id: "dns", type: "DNS", x: 0, y: 0, ...(maxTtlSeconds === undefined ? {} : { dnsCachePolicy: { version: 1, maxTtlSeconds } }) },
    { id: "app", type: mode === "vm" ? "Virtual Machine" : "CDN", x: 1, y: 0 },
    ...(mode === "cdn" ? [{ id: "store", type: "Object Storage" as const, x: 2, y: 0 }] : [])];
  return { resources, connectionLines: [["dns", "app"], ...(mode === "cdn" ? [["app", "store"]] : [])].map(([s, t], index) => ({ id: `e${index}`, sourceId: s!, targetId: t!, sourceType: resources.find(r => r.id === s)!.type, targetType: resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === t)!.type] })) };
}
