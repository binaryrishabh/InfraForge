import type { Sku } from "./catalog.types";

/* DigitalOcean catalog snapshot — CATALOG_SNAPSHOT_DATE. Droplet prices are
the long-stable standard tiers. Managed database prices and connection limits
are approximations. OWNER: verify against digitalocean.com/pricing. */

export const DO_COMPUTE: Sku[] = [
  { skuId: "s-1vcpu-512mb-10gb", provider: "digitalocean", category: "Virtual Machine", family: "Basic (shared)", label: "Basic — 1 vCPU / 512 MB", vCpu: 1, ramGb: 0.5, baselineFactor: 1, monthlyPriceUsd: 4, networkGbps: 1 },
  { skuId: "s-1vcpu-1gb", provider: "digitalocean", category: "Virtual Machine", family: "Basic (shared)", label: "Basic — 1 vCPU / 1 GB", vCpu: 1, ramGb: 1, baselineFactor: 1, monthlyPriceUsd: 6, networkGbps: 1 },
  { skuId: "s-1vcpu-2gb", provider: "digitalocean", category: "Virtual Machine", family: "Basic (shared)", label: "Basic — 1 vCPU / 2 GB", vCpu: 1, ramGb: 2, baselineFactor: 1, monthlyPriceUsd: 12, networkGbps: 2 },
  { skuId: "s-2vcpu-2gb", provider: "digitalocean", category: "Virtual Machine", family: "Basic (shared)", label: "Basic — 2 vCPU / 2 GB", vCpu: 2, ramGb: 2, baselineFactor: 1, monthlyPriceUsd: 18, networkGbps: 2 },
  { skuId: "s-2vcpu-4gb", provider: "digitalocean", category: "Virtual Machine", family: "Basic (shared)", label: "Basic — 2 vCPU / 4 GB", vCpu: 2, ramGb: 4, baselineFactor: 1, monthlyPriceUsd: 24, networkGbps: 3 },
  { skuId: "s-4vcpu-8gb", provider: "digitalocean", category: "Virtual Machine", family: "Basic (shared)", label: "Basic — 4 vCPU / 8 GB", vCpu: 4, ramGb: 8, baselineFactor: 1, monthlyPriceUsd: 48, networkGbps: 4 },
  { skuId: "s-8vcpu-16gb", provider: "digitalocean", category: "Virtual Machine", family: "Basic (shared)", label: "Basic — 8 vCPU / 16 GB", vCpu: 8, ramGb: 16, baselineFactor: 1, monthlyPriceUsd: 96, networkGbps: 6 },
  { skuId: "c-2", provider: "digitalocean", category: "Virtual Machine", family: "CPU Optimized (dedicated)", label: "c-2 — 2 vCPU / 4 GB", vCpu: 2, ramGb: 4, baselineFactor: 1, monthlyPriceUsd: 42, networkGbps: 3 },
  { skuId: "c-4", provider: "digitalocean", category: "Virtual Machine", family: "CPU Optimized (dedicated)", label: "c-4 — 4 vCPU / 8 GB", vCpu: 4, ramGb: 8, baselineFactor: 1, monthlyPriceUsd: 84, networkGbps: 4 }
];

export const DO_DATABASE: Sku[] = [
  { skuId: "db-s-1vcpu-1gb", provider: "digitalocean", category: "Database", family: "Basic (Postgres)", label: "Managed PG — 1 vCPU / 1 GB", vCpu: 1, ramGb: 1, baselineFactor: 1, monthlyPriceUsd: 15, maxConnections: 100 },
  { skuId: "db-s-1vcpu-2gb", provider: "digitalocean", category: "Database", family: "Basic (Postgres)", label: "Managed PG — 1 vCPU / 2 GB", vCpu: 1, ramGb: 2, baselineFactor: 1, monthlyPriceUsd: 30, maxConnections: 150 },
  { skuId: "db-s-2vcpu-4gb", provider: "digitalocean", category: "Database", family: "Basic (Postgres)", label: "Managed PG — 2 vCPU / 4 GB", vCpu: 2, ramGb: 4, baselineFactor: 1, monthlyPriceUsd: 60, maxConnections: 250 },
  { skuId: "db-s-4vcpu-8gb", provider: "digitalocean", category: "Database", family: "Basic (Postgres)", label: "Managed PG — 4 vCPU / 8 GB", vCpu: 4, ramGb: 8, baselineFactor: 1, monthlyPriceUsd: 120, maxConnections: 400 },
  { skuId: "db-s-6vcpu-16gb", provider: "digitalocean", category: "Database", family: "Basic (Postgres)", label: "Managed PG — 6 vCPU / 16 GB", vCpu: 6, ramGb: 16, baselineFactor: 1, monthlyPriceUsd: 240, maxConnections: 600 },
  { skuId: "gd-2vcpu-8gb", provider: "digitalocean", category: "Database", family: "General Purpose (dedicated)", label: "Managed PG — 2 vCPU / 8 GB", vCpu: 2, ramGb: 8, baselineFactor: 1, monthlyPriceUsd: 145, maxConnections: 400 }
];