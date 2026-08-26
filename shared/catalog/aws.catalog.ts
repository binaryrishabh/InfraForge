import type { Sku } from "./catalog.types";

/* AWS catalog snapshot — CATALOG_SNAPSHOT_DATE. Approximate list prices,
us-east-1 on-demand. Burstable baselines: t3 micro 10% / small 20% /
medium 40% / large 60%. RDS maxConnections are memory-scaled approximations.
OWNER: verify against AWS pricing pages before trusting. */

export const AWS_COMPUTE: Sku[] = [
  { skuId: "t3.micro", provider: "aws", category: "Virtual Machine", family: "General Purpose (burstable)", label: "t3.micro — 2 vCPU / 1 GB", vCpu: 2, ramGb: 1, baselineFactor: 0.10, monthlyPriceUsd: 7.60, networkGbps: 5 },
  { skuId: "t3.small", provider: "aws", category: "Virtual Machine", family: "General Purpose (burstable)", label: "t3.small — 2 vCPU / 2 GB", vCpu: 2, ramGb: 2, baselineFactor: 0.20, monthlyPriceUsd: 15.20, networkGbps: 5 },
  { skuId: "t3.medium", provider: "aws", category: "Virtual Machine", family: "General Purpose (burstable)", label: "t3.medium — 2 vCPU / 4 GB", vCpu: 2, ramGb: 4, baselineFactor: 0.40, monthlyPriceUsd: 30.40, networkGbps: 5 },
  { skuId: "t3.large", provider: "aws", category: "Virtual Machine", family: "General Purpose (burstable)", label: "t3.large — 2 vCPU / 8 GB", vCpu: 2, ramGb: 8, baselineFactor: 0.60, monthlyPriceUsd: 60.75, networkGbps: 5 },
  { skuId: "m5.large", provider: "aws", category: "Virtual Machine", family: "General Purpose", label: "m5.large — 2 vCPU / 8 GB", vCpu: 2, ramGb: 8, baselineFactor: 1, monthlyPriceUsd: 70.10, networkGbps: 10 },
  { skuId: "m5.xlarge", provider: "aws", category: "Virtual Machine", family: "General Purpose", label: "m5.xlarge — 4 vCPU / 16 GB", vCpu: 4, ramGb: 16, baselineFactor: 1, monthlyPriceUsd: 140.20, networkGbps: 10 },
  { skuId: "m5.2xlarge", provider: "aws", category: "Virtual Machine", family: "General Purpose", label: "m5.2xlarge — 8 vCPU / 32 GB", vCpu: 8, ramGb: 32, baselineFactor: 1, monthlyPriceUsd: 280.30, networkGbps: 10 },
  { skuId: "c5.large", provider: "aws", category: "Virtual Machine", family: "Compute Optimized", label: "c5.large — 2 vCPU / 4 GB", vCpu: 2, ramGb: 4, baselineFactor: 1, monthlyPriceUsd: 62.05, networkGbps: 10 },
  { skuId: "c5.xlarge", provider: "aws", category: "Virtual Machine", family: "Compute Optimized", label: "c5.xlarge — 4 vCPU / 8 GB", vCpu: 4, ramGb: 8, baselineFactor: 1, monthlyPriceUsd: 124.10, networkGbps: 10 },
  { skuId: "r5.large", provider: "aws", category: "Virtual Machine", family: "Memory Optimized", label: "r5.large — 2 vCPU / 16 GB", vCpu: 2, ramGb: 16, baselineFactor: 1, monthlyPriceUsd: 92.00, networkGbps: 10 }
];

export const AWS_DATABASE: Sku[] = [
  { skuId: "db.t3.micro", provider: "aws", category: "Database", family: "Burstable (Postgres)", label: "db.t3.micro — 2 vCPU / 1 GB", vCpu: 2, ramGb: 1, baselineFactor: 0.10, monthlyPriceUsd: 12.40, maxConnections: 85 },
  { skuId: "db.t3.small", provider: "aws", category: "Database", family: "Burstable (Postgres)", label: "db.t3.small — 2 vCPU / 2 GB", vCpu: 2, ramGb: 2, baselineFactor: 0.20, monthlyPriceUsd: 24.80, maxConnections: 170 },
  { skuId: "db.t3.medium", provider: "aws", category: "Database", family: "Burstable (Postgres)", label: "db.t3.medium — 2 vCPU / 4 GB", vCpu: 2, ramGb: 4, baselineFactor: 0.40, monthlyPriceUsd: 49.65, maxConnections: 340 },
  { skuId: "db.m5.large", provider: "aws", category: "Database", family: "General Purpose (Postgres)", label: "db.m5.large — 2 vCPU / 8 GB", vCpu: 2, ramGb: 8, baselineFactor: 1, monthlyPriceUsd: 124.85, maxConnections: 680 },
  { skuId: "db.m5.xlarge", provider: "aws", category: "Database", family: "General Purpose (Postgres)", label: "db.m5.xlarge — 4 vCPU / 16 GB", vCpu: 4, ramGb: 16, baselineFactor: 1, monthlyPriceUsd: 249.70, maxConnections: 1360 },
  { skuId: "db.m5.2xlarge", provider: "aws", category: "Database", family: "General Purpose (Postgres)", label: "db.m5.2xlarge — 8 vCPU / 32 GB", vCpu: 8, ramGb: 32, baselineFactor: 1, monthlyPriceUsd: 499.35, maxConnections: 2720 },
  { skuId: "db.r5.large", provider: "aws", category: "Database", family: "Memory Optimized (Postgres)", label: "db.r5.large — 2 vCPU / 16 GB", vCpu: 2, ramGb: 16, baselineFactor: 1, monthlyPriceUsd: 173.75, maxConnections: 1360 }
];