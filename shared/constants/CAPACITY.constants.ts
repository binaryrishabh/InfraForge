import { RESOURCE_TYPES, type ResourceType } from "./RESOURCE_TYPES.constants";

// Generic fallback capacity for resources WITHOUT a selected SKU.
export const CAPACITY: Record<ResourceType, { rps: number; source: string }> = {
  [RESOURCE_TYPES.DNS]: { rps: 5000, source: "named" },
  [RESOURCE_TYPES.CDN]: { rps: 20000, source: "edge" },
  [RESOURCE_TYPES.Firewall]: { rps: 15000, source: "waf" },
  [RESOURCE_TYPES.LoadBalancer]: { rps: 10000, source: "nginx" },
  [RESOURCE_TYPES.VirtualMachine]: { rps: 160, source: "app" },
  [RESOURCE_TYPES.ContainerRegistry]: { rps: 1000, source: "registry" },
  [RESOURCE_TYPES.Cache]: { rps: 8000, source: "redis" },
  [RESOURCE_TYPES.Database]: { rps: 250, source: "postgres" },
  [RESOURCE_TYPES.ObjectStorage]: { rps: 2000, source: "storage" },
  [RESOURCE_TYPES.MessageQueue]: { rps: 5000, source: "rabbitmq" },
  [RESOURCE_TYPES.MonitoringAgent]: { rps: 10000, source: "agent" }
};

export type CapacityType = typeof CAPACITY;