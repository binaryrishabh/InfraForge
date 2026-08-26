import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { findSku } from "@shared/catalog/index";
import type { Resource } from "@shared/types/Resource.types";
import type { DeploymentStageResult } from "@shared/types/DeploymentStageResult.types";

// Transitional fallback for resources without a selected SKU.
// Audit: disappears as the SKU picker covers more resource categories.
const GENERIC_MONTHLY_USD: Record<string, number> = {
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
  [RESOURCE_TYPES.MonitoringAgent]: 8
};

export const runCostEstimation = (resources: Resource[]): DeploymentStageResult => {
  let monthlyEstimate = 0;
  const breakdown: Record<string, number> = {};
  const lineItems: Array<{ resourceId: string; type: string; provider?: string; skuId?: string; skuLabel?: string; monthlyUsd: number }> = [];

  for (const resource of resources) {
    const sku = resource.skuId ? findSku(resource.skuId) : undefined;
    const monthlyUsd = sku ? sku.monthlyPriceUsd : (GENERIC_MONTHLY_USD[resource.type] ?? 10);
    monthlyEstimate += monthlyUsd;
    breakdown[resource.type] = (breakdown[resource.type] || 0) + monthlyUsd;
    lineItems.push({
      resourceId: resource.id,
      type: resource.type,
      provider: sku?.provider,
      skuId: sku?.skuId,
      skuLabel: sku?.label,
      monthlyUsd
    });
  }

  return {
    status: "passed",
    summary: `Estimated monthly cost: $${monthlyEstimate.toFixed(2)}`,
    details: { monthlyEstimate, breakdown, lineItems }
  };
};