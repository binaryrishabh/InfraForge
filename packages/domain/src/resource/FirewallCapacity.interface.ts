/** Optional educational tracked connection limit; omission preserves the historical core-based limit. */
export interface FirewallCapacity { version: 1; maxFlows: number }
// Mirrors SYSTEM_LIMITS.flows in the existing systems executor.
export const FIREWALL_FLOW_CAPACITY_MAX = 100000;
export const FIREWALL_FLOW_CAPACITY_HELP = "Maximum active connections this firewall can remember at once. New connections are refused while the state table is full. Educational modeled limit; no provider capacity claim. Blank keeps 10000 × modeled firewall cores.";
export function firewallCapacityError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Firewall") return "Firewall capacity belongs to Firewall.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Firewall capacity requires version 1 and maxFlows.";
  const p = value as Record<string, unknown>;
  if (p.version !== 1 || Object.keys(p).some(k => !["version", "maxFlows"].includes(k))) return "Firewall capacity requires version 1 with only its own fields.";
  if (typeof p.maxFlows !== "number" || !Number.isSafeInteger(p.maxFlows) || p.maxFlows < 1 || p.maxFlows > FIREWALL_FLOW_CAPACITY_MAX) return `Tracked connection limit must be an integer from 1 to ${FIREWALL_FLOW_CAPACITY_MAX}.`;
}
