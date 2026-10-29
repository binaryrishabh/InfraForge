import type { ResourceTemplate } from "./contracts";
export const TRANSLATION_OWNERS = {
  DNS: { kinds: ["dns-authority", "dns-resolver"], owner: "systems/dns", requires: "A records/TTL/generation or explicit authority, cache capacity, command demand and bootstrap transport" },
  CDN: { kinds: ["cdn"], owner: "systems/cdn", requires: "origin, object key mapping, byte capacity/TTL/coalescing, command demand" },
  Firewall: { kinds: [], owner: "systems/security", requires: "ordered-stateful policy/rules/flow limit and explicit path attachments; no transit capacity" },
  "Load Balancer": { kinds: ["load-balancer"], owner: "network/load-balancer", requires: "backend intent, health operation/timing, routing, admission limits and paths" },
  "Virtual Machine": { kinds: ["compute", "async-worker"], owner: "compute/resource", requires: "application operation demand, workers, authored effective cores/memory ownership and explicit dependency" },
  "Container Registry": { kinds: ["registry"], owner: "systems/registry", requires: "object-store backing, namespace, command demand and artifact identity" },
  Cache: { kinds: ["cache"], owner: "data/cache", requires: "logical bytes, key state, TTL/eviction and command CPU" },
  Database: { kinds: ["relational"], owner: "data/database", requires: "keyed transaction plans, sessions/locks/timeouts/CPU and logical durability" },
  "Object Storage": { kinds: ["object-store"], owner: "async/objects", requires: "namespace/key/generation/bytes, conditional state and command demands" },
  "Message Queue": { kinds: ["delivery-queue"], owner: "async/broker", requires: "lease, retention, capacity, consumers, attempts and DLQ policy" },
  "Monitoring Agent": { kinds: ["monitor"], owner: "systems/monitor", requires: "explicit targets/instrumentation/backend, collection/export schedule/buffers/demand" },
} as const;
export function ownerAccepts(type: keyof typeof TRANSLATION_OWNERS, config: ResourceTemplate) { return (TRANSLATION_OWNERS[type].kinds as readonly string[]).includes(config.kind); }
export function rewriteReferences<T>(value: T, resolve: (reference: string) => string): T {
  if (typeof value === "string") return (value.startsWith("$") && value !== "$caller" ? resolve(value) : value) as T;
  if (Array.isArray(value)) return value.map((v) => rewriteReferences(v, resolve)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteReferences(v, resolve)])) as T;
  return value;
}
