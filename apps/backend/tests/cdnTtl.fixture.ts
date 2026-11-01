import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";

export const cdnWorkload = { targetThroughput: 120, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
export function cdnLayout(ttlSeconds?: number, mode: "repeated" | "dns" | "monitoring" = "repeated") {
  const resources: Resource[] = [
    { id: "cdn", type: "CDN", x: 0, y: 0, ...(ttlSeconds === undefined ? {} : { cdnCachePolicy: { version: 1, ttlSeconds } }) },
    { id: "store", type: "Object Storage", x: 1, y: 0 },
    ...(mode === "dns" ? [{ id: "dns", type: "DNS" as const, x: 0, y: 1 }] : []),
    ...(mode === "monitoring" ? [{ id: "monitor", type: "Monitoring Agent" as const, x: 0, y: 1 }] : []),
  ];
  return { resources, connectionLines: [["cdn", "store"], ...(mode === "dns" ? [["dns", "cdn"]] : []), ...(mode === "monitoring" ? [["monitor", "cdn"]] : [])].map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: resources.find(r => r.id === s)!.type, targetType: resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === t)!.type] })) };
}
