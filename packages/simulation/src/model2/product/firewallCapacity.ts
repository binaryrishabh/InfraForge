import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const FIREWALL_CAPACITY_PROFILE = "firewall-flow-capacity/1" as const;
export const changedFirewallCapacity = (r: Resource) => r.firewallCapacity !== undefined;
export const firewallCapacityChanges = (resources: readonly Resource[]) => resources.some(changedFirewallCapacity);
export function firewallCapacity(r: Resource, cores: number, q: (id: string, value: number, unit: "count", sentence?: string, authored?: boolean) => Quantity<"count">, ledger: ProductContract["ledger"]) {
  const p = r.firewallCapacity;
  if (p === undefined) return q(`${r.id}.flows`, 10000 * cores, "count");
  const sentence = "Saved educational modeled tracked connection limit; no provider capacity claim.";
  const capacity = q(`${r.id}.flows`, p.maxFlows, "count", sentence, true);
  Object.assign(ledger.at(-1)!, { classification: "user-input", formula: String(p.maxFlows), provenance: [{ source: `saved-design:${r.id}.firewallCapacity.maxFlows`, supports: "implementation", detail: sentence }] });
  return capacity;
}
export function validateFirewallCapacityProfile(resources: readonly Resource[], contract: ProductContract) {
  const count = (version: string) => {
    const profiles = version.match(/\/firewall-flow-capacity\/[^/]+/g) ?? [];
    if (profiles.some(p => p !== `/${FIREWALL_CAPACITY_PROFILE}`)) throw Error("Unsupported firewall capacity profile");
    return profiles.length;
  };
  if (count(contract.version) !== Number(firewallCapacityChanges(resources))) throw Error("Firewall capacity requires its explicit firewall-flow-capacity/1 contract version and matching saved intent");
  for (const r of resources) if (count(contract.nodes[r.id]?.profileVersion ?? "") !== Number(changedFirewallCapacity(r))) throw Error("Firewall capacity requires its owned profile and matching saved intent");
}
export function validateFirewallCapacityBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedFirewallCapacity)) {
    const p = r.firewallCapacity, firewall = input.systems.firewalls.find(f => f.id === r.id);
    if (!p || r.type !== "Firewall" || !firewall || requireKnown(firewall.maxFlows, "count") !== p.maxFlows) throw Error("Firewall capacity must match saved intent on its owned Firewall engine");
  }
}
