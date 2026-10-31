import type { ConnectionLine } from "../resource/ConnectionLine.interface";
import type { Resource } from "../resource/Resource.interface";
import { RESOURCE_TYPES } from "../resource/RESOURCE_TYPES.constants";

/* Native v3 card spacing (CARD_LAYOUT_VERSION 3, 208x160 cards on the
24px grid): 432px column step, 288px row step. Loads as-is — the old
frontend re-spacing hack is gone. Old 48px-era coordinates retired.
Both app servers share one database-backed cache behind a load balancer. */
export const SAMPLE_ARCHITECTURE: { resources: Resource[]; connectionLines: ConnectionLine[]; } = {
  resources: [
    { id: "dns-1", type: RESOURCE_TYPES.DNS, x: 0, y: 0 },
    { id: "lb-1", type: RESOURCE_TYPES.LoadBalancer, x: 0, y: 288 },
    { id: "vm-1", type: RESOURCE_TYPES.VirtualMachine, x: 432, y: 0 },
    { id: "vm-2", type: RESOURCE_TYPES.VirtualMachine, x: 432, y: 576 },
    { id: "cache-1", type: RESOURCE_TYPES.Cache, x: 864, y: 288 },
    { id: "db-1", type: RESOURCE_TYPES.Database, x: 1296, y: 288 },
  ],
  connectionLines: [
    { id: "c1", sourceId: "dns-1", targetId: "lb-1", sourceType: "DNS", targetType: "Load Balancer", port: 80 },
    { id: "c2", sourceId: "lb-1", targetId: "vm-1", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
    { id: "c3", sourceId: "lb-1", targetId: "vm-2", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
    { id: "c4", sourceId: "vm-1", targetId: "cache-1", sourceType: "Virtual Machine", targetType: "Cache", port: 6379 },
    { id: "c5", sourceId: "vm-2", targetId: "cache-1", sourceType: "Virtual Machine", targetType: "Cache", port: 6379 },
    { id: "c6", sourceId: "cache-1", targetId: "db-1", sourceType: "Cache", targetType: "Database", port: 5432 },
  ],
};
