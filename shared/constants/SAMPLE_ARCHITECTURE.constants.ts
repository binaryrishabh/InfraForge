import type { ConnectionLine } from "../interface/ConnectionLine.interface";
import type { Resource } from "../interface/Resource.interface";
import { RESOURCE_TYPES } from "./RESOURCE_TYPES.constants";

/* Card-scale spacing (24-grid): 288px column step, 192px row step, so the
220x140 dashboard cards never overlap. Old 48px-era coordinates retired. */
export const SAMPLE_ARCHITECTURE: { resources: Resource[]; connectionLines: ConnectionLine[]; } = {
    resources: [
        { id: "dns-1", type: RESOURCE_TYPES.DNS, x: 0, y: 0 },
        { id: "cdn-1", type: RESOURCE_TYPES.CDN, x: 0, y: 192 },
        { id: "lb-1", type: RESOURCE_TYPES.LoadBalancer, x: 0, y: 384 },
        { id: "vm-1", type: RESOURCE_TYPES.VirtualMachine, x: 288, y: 192 },
        { id: "vm-2", type: RESOURCE_TYPES.VirtualMachine, x: 288, y: 576 },
        { id: "cache-1", type: RESOURCE_TYPES.Cache, x: 576, y: 192 },
        { id: "db-1", type: RESOURCE_TYPES.Database, x: 576, y: 384 },
        { id: "storage-1", type: RESOURCE_TYPES.ObjectStorage, x: 864, y: 384 },
        { id: "monitor-1", type: RESOURCE_TYPES.MonitoringAgent, x: 576, y: 768 },
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