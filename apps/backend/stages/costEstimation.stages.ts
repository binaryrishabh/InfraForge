import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import { findSku } from "@infraforge/catalog";
import { GENERIC_MONTHLY_USD } from "@infraforge/simulation/cost";
import type { Resource } from "@infraforge/domain/resource";
import type { DeploymentStageResult } from "../types/DeploymentStageResult.interface";

export const runCostEstimation = (resources: Resource[]): DeploymentStageResult => {
  const unpriced = resources.filter(r => (r.type === "Scheduler" || r.type === "Event Bus" || r.type === "API Gateway")).map(r => r.id);
  if (unpriced.length) return { status: "warning", summary: "Model cost Unknown: no price profile for this resource.", details: { unknownResources: unpriced } };
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