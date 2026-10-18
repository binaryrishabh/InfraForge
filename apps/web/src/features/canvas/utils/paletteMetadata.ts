import { CAPACITY } from "@infraforge/simulation/capacity";
import type { ResourceType } from "@infraforge/domain/resource";

/* What each resource does in the model, in plain words. Deliberately no product names:
the simulator models roles and declared capacity, not any particular cloud's service. */
export const ROLE_SUBLABELS: Record<ResourceType, string> = {
  DNS: "Turns names into addresses",
  CDN: "Serves cached content near users",
  Firewall: "Filters traffic at the edge",
  "Load Balancer": "Spreads requests across targets",
  "Virtual Machine": "Runs the application",
  "Container Registry": "Stores images to deploy",
  Cache: "Answers repeat reads from memory",
  Database: "Keeps the records",
  "Object Storage": "Holds files and blobs",
  "Message Queue": "Buffers work between services",
  "Monitoring Agent": "Reports what it observes",
};

/* Generic fallback capacity, compactly formatted: 5000 -> "5k",
20000 -> "20k", 160 -> "160". Reads from the shared CAPACITY table so the
label tracks any future constant change in one place. */
export function capacityLabel(type: ResourceType): string {
  const rps = CAPACITY[type].rps;
  const compact = rps >= 1000 ? `${Math.round(rps / 1000)}k` : `${rps}`;
  return `${compact} rps`;
}