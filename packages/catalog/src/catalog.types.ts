/*
InfraForge SKU Catalog — types and provider registry.
Curated versioned snapshot. Prices are approximate on-demand list prices
(AWS us-east-1, DigitalOcean standard tiers). Connection limits are
approximations. OWNER VERIFICATION REQUIRED before trusting any number.
*/

export const CATALOG_SNAPSHOT_DATE = "2026-08";

export type ProviderId = "aws" | "digitalocean";

export const PROVIDERS: Record<ProviderId, { id: ProviderId; name: string }> = {
  aws: { id: "aws", name: "Amazon Web Services" },
  digitalocean: { id: "digitalocean", name: "DigitalOcean" }
};

export type SkuCategory = "Virtual Machine" | "Database";

export interface Sku {
  skuId: string;
  provider: ProviderId;
  category: SkuCategory;
  family: string;
  label: string;
  vCpu: number;
  ramGb: number;
  baselineFactor: number;      // 1.0 = dedicated cores; < 1.0 = burstable baseline
  monthlyPriceUsd: number;     // approximate on-demand monthly
  maxConnections?: number;     // databases only
  networkGbps?: number;        // compute only
}