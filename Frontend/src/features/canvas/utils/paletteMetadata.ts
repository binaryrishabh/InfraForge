import { CAPACITY } from "@shared/constants/CAPACITY.constants";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

/* Real-product sublabels for palette rows — identity flavor only, never
consumed by simulation math (Section 6: capacity stays catalog/CAPACITY-derived). */
export const PRODUCT_SUBLABELS: Record<ResourceType, string> = {
  DNS: "Route 53 / Cloud DNS",
  CDN: "CloudFront / CDN",
  Firewall: "WAF / edge rules",
  "Load Balancer": "ALB / nginx",
  "Virtual Machine": "EC2 / Droplets",
  "Container Registry": "ECR / registry",
  Cache: "ElastiCache / Redis",
  Database: "RDS PG / Managed PG",
  "Object Storage": "S3 / Spaces",
  "Message Queue": "SQS / RabbitMQ",
  "Monitoring Agent": "Prometheus-style agent",
};

/* Generic fallback capacity, compactly formatted: 5000 -> "5k",
20000 -> "20k", 160 -> "160". Reads from the shared CAPACITY table so the
label tracks any future constant change in one place. */
export function capacityLabel(type: ResourceType): string {
  const rps = CAPACITY[type].rps;
  const compact = rps >= 1000 ? `${Math.round(rps / 1000)}k` : `${rps}`;
  return `${compact} rps`;
}