import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { findSku } from "@shared/catalog/index";
import { GENERIC_MONTHLY_USD } from "@shared/simulation/cost";
import type { Resource } from "@shared/interface/Resource.interface";
import type { DeploymentStageResult } from "@shared/interface/DeploymentStageResult.interface";

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