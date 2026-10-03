import type { Sku, ProviderId, SkuCategory } from "./catalog.types";
import { AWS_COMPUTE, AWS_DATABASE } from "./aws.catalog";
import { DO_COMPUTE, DO_DATABASE } from "./digitalocean.catalog";

export * from "./catalog.types";

export const CATALOG: Sku[] = [...AWS_COMPUTE, ...AWS_DATABASE, ...DO_COMPUTE, ...DO_DATABASE];

const skuIndex = new Map(CATALOG.map(s => [s.skuId, s]));

export const findSku = (skuId: string): Sku | undefined => skuIndex.get(skuId);

export const skusFor = (provider: ProviderId, category: SkuCategory): Sku[] =>
  CATALOG.filter(s => s.provider === provider && s.category === category);