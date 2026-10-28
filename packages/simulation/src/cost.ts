/* Monthly price for a resource without a selected SKU, shared by the deployment cost estimate and live burn rate. */
import { RESOURCE_TYPES } from "@infraforge/domain/resource";

// Transitional fallback for resources without a selected SKU.
// Mirrors the deployment-time cost estimate. OWNER: keep in sync with
// real provider pricing as the SKU catalog expands.
export const GENERIC_MONTHLY_USD: Record<string, number> = {
  [RESOURCE_TYPES.DNS]: 3,
  [RESOURCE_TYPES.CDN]: 10,
  [RESOURCE_TYPES.Firewall]: 10,
  [RESOURCE_TYPES.LoadBalancer]: 20,
  [RESOURCE_TYPES.VirtualMachine]: 15,
  [RESOURCE_TYPES.ContainerRegistry]: 15,
  [RESOURCE_TYPES.Cache]: 25,
  [RESOURCE_TYPES.Database]: 40,
  [RESOURCE_TYPES.MessageQueue]: 30,
  [RESOURCE_TYPES.ObjectStorage]: 5,
  [RESOURCE_TYPES.MonitoringAgent]: 8,
};
