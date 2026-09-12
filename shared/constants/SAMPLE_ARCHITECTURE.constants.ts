import type { ConnectionLine } from "../interface/ConnectionLine.interface";
import type { Resource } from "../interface/Resource.interface";
import { RESOURCE_TYPES } from "./RESOURCE_TYPES.constants";

/* Native v3 card spacing (CARD_LAYOUT_VERSION 3, 208x160 cards on the
24px grid): 432px column step, 288px row step. Loads as-is — the old
frontend re-spacing hack is gone. Old 48px-era coordinates retired. */
export const SAMPLE_ARCHITECTURE: { resources: Resource[]; connectionLines: ConnectionLine[]; } = {
  resources: [
    { id: "dns-1", type: RESOURCE_TYPES.DNS, x: 0, y: 0 },
    { id: "cdn-1", type: RESOURCE_TYPES.CDN, x: 0, y: 288 },
    { id: "lb-1", type: RESOURCE_TYPES.LoadBalancer, x: 0, y: 576 },
    { id: "vm-1", type: RESOURCE_TYPES.VirtualMachine, x: 432, y: 288 },
    { id: "vm-2", type: RESOURCE_TYPES.VirtualMachine, x: 432, y: 864 },
    { id: "cache-1", type: RESOURCE_TYPES.Cache, x: 864, y: 288 },
    { id: "db-1", type: RESOURCE_TYPES.Database, x: 864, y: 576 },
    { id: "storage-1", type: RESOURCE_TYPES.ObjectStorage, x: 1296, y: 576 },
    { id: "monitor-1", type: RESOURCE_TYPES.MonitoringAgent, x: 864, y: 1152 },
  ],
  connectionLines: [
    { id: "c1", sourceId: "dns-1", targetId: "cdn-1", sourceType: "DNS", targetType: "CDN", port: 443 },
    { id: "c2", sourceId: "cdn-1", targetId: "lb-1", sourceType: "CDN", targetType: "Load Balancer", port: 80 },
    { id: "c3", sourceId: "lb-1", targetId: "vm-1", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
    { id: "c4", sourceId: "lb-1", targetId: "vm-2", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
    { id: "c5", sourceId: "vm-1", targetId: "cache-1", sourceType: "Virtual Machine", targetType: "Cache", port: 6379 },
    { id: "c6", sourceId: "cache-1", targetId: "db-1", sourceType: "Cache", targetType: "Database", port: 5432 },
    { id: "c7", sourceId: "db-1", targetId: "storage-1", sourceType: "Database", targetType: "Object Storage", port: 443 },
    { id: "c8", sourceId: "monitor-1", targetId: "vm-1", sourceType: "Monitoring Agent", targetType: "Virtual Machine", port: 80 },
  ],
};