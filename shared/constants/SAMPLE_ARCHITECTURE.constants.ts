import { ConnectionLine } from "../interface/ConnectionLine.interface";
import { Resource } from "../interface/Resource.interface";
import { RESOURCE_TYPES } from "./RESOURCE_TYPES.constants";

export const SAMPLE_ARCHITECTURE: { resources: Resource[]; connectionLines: ConnectionLine[]; } = {
  resources: [
    { id: "dns-1", type: RESOURCE_TYPES.DNS, x: 48, y: 48 },
    { id: "cdn-1", type: RESOURCE_TYPES.CDN, x: 48, y: 144 },
    { id: "lb-1", type: RESOURCE_TYPES.LoadBalancer, x: 48, y: 240 },
    { id: "vm-1", type: RESOURCE_TYPES.VirtualMachine, x: 200, y: 144 },
    { id: "vm-2", type: RESOURCE_TYPES.VirtualMachine, x: 200, y: 336 },
    { id: "db-1", type: RESOURCE_TYPES.Database, x: 360, y: 240 },
    { id: "cache-1", type: RESOURCE_TYPES.Cache, x: 360, y: 144 },
    { id: "storage-1", type: RESOURCE_TYPES.ObjectStorage, x: 520, y: 240 },
    { id: "monitor-1", type: RESOURCE_TYPES.MonitoringAgent, x: 360, y: 400 },
  ],
  connectionLines: [
    { id: "c1", sourceId: "dns-1", targetId: "cdn-1", sourceType: "DNS", targetType: "CDN", port: 53 },
    { id: "c2", sourceId: "cdn-1", targetId: "lb-1", sourceType: "CDN", targetType: "Load Balancer", port: 443 },
    { id: "c3", sourceId: "lb-1", targetId: "vm-1", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
    { id: "c4", sourceId: "lb-1", targetId: "vm-2", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
    { id: "c5", sourceId: "vm-1", targetId: "cache-1", sourceType: "Virtual Machine", targetType: "Cache", port: 6379 },
    { id: "c6", sourceId: "cache-1", targetId: "db-1", sourceType: "Cache", targetType: "Database", port: 5432 },
    { id: "c7", sourceId: "db-1", targetId: "storage-1", sourceType: "Database", targetType: "Object Storage", port: 0 },
    { id: "c8", sourceId: "monitor-1", targetId: "vm-1", sourceType: "Monitoring Agent", targetType: "Virtual Machine", port: 9090 },
  ],
};