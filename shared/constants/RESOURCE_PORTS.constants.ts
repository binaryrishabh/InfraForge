import { RESOURCE_TYPES, type ResourceType } from "./RESOURCE_TYPES.constants";

// A connection's port = the listening port of the resource it points TO.
export const RESOURCE_PORTS: Record<ResourceType, number> = {
  [RESOURCE_TYPES.DNS]: 53,
  [RESOURCE_TYPES.CDN]: 443,
  [RESOURCE_TYPES.Firewall]: 443,          // inline pass-through, managed over HTTPS; never a connection target
  [RESOURCE_TYPES.LoadBalancer]: 80,
  [RESOURCE_TYPES.VirtualMachine]: 80,     // app-server traffic port (was 22/SSH, which is management-only)
  [RESOURCE_TYPES.ContainerRegistry]: 443,
  [RESOURCE_TYPES.Cache]: 6379,
  [RESOURCE_TYPES.Database]: 5432,
  [RESOURCE_TYPES.ObjectStorage]: 443,     // S3-style HTTPS API (was 0)
  [RESOURCE_TYPES.MessageQueue]: 5672,
  [RESOURCE_TYPES.MonitoringAgent]: 9090,
} as const;

export type ResourcePortsType = typeof RESOURCE_PORTS;