import { findSku } from "@infraforge/catalog";
import { RESOURCE_TYPES, type Resource, type ResourceType } from "@infraforge/domain/resource";

// Model 2 educational sizing, shared by the compiler and design cards. Catalog
// vCPU labels size assumed cores; burst credits/baseline throttling are not modeled.
// This is CPU sizing, not a workload-independent RPS/QPS or provider guarantee.
export function modeledResourceSizing(resource: Pick<Resource, "type" | "skuId" | "size">) {
  const sku = resource.skuId ? findSku(resource.skuId) : undefined;
  if (resource.skuId && (!sku || sku.category !== resource.type)) return null;
  const scale = { small: 1, medium: 2, large: 4 }[resource.size ?? "small"];
  return { cores: sku?.vCpu ?? scale, memoryGb: sku?.ramGb ?? scale * 2 };
}

// Generic fallback capacity for resources WITHOUT a selected SKU.
export const CAPACITY: Partial<Record<ResourceType, { rps: number; source: string }>> = {
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
