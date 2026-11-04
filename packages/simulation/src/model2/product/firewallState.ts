import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const FIREWALL_STATE_PROFILE = "firewall-state/1" as const;
export const firewallStateChanges = (resources: readonly Resource[]) => resources.some(r => r.firewallState !== undefined);
export function firewallState(r: Resource, q: (id: string, value: number, unit: "us", sentence?: string, authored?: boolean) => Quantity<"us">) {
  return r.firewallState === undefined ? {} : { statePolicy: { version: 1 as const,
    idleTimeout: q(`${r.id}.flowIdleTimeout`, r.firewallState.idleTimeoutSeconds * 1000000, "us", "Saved semantic request/response idle timeout; expiry precedes equal-time policy changes and arrivals. Established flows retain admission until expiry. No packet model.", true) } };
}
export function validateFirewallStateProfile(resources: readonly Resource[], contract: ProductContract) {
  const count = (version: string) => {
    const profiles = version.match(/\/firewall-state\/[^/]+/g) ?? [];
    if (profiles.some(p => p !== `/${FIREWALL_STATE_PROFILE}`)) throw Error("Unsupported firewall state profile");
    return profiles.length;
  };
  if (firewallStateChanges(resources) && contract.failureCauseProfile !== "failure-cause/1") throw Error("Firewall state requires failure-cause/1 evidence");
  if (count(contract.version) !== Number(firewallStateChanges(resources))) throw Error("Firewall state requires its explicit firewall-state/1 profile and matching saved intent");
  for (const r of resources) if (count(contract.nodes[r.id]?.profileVersion ?? "") !== Number(r.firewallState !== undefined)) throw Error("Firewall state requires its owned profile and matching saved intent");
}
export function validateFirewallStateBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const f of input.systems.firewalls) {
    const saved = resources.find(r => r.id === f.id)?.firewallState;
    if (saved === undefined) { if (f.statePolicy !== undefined) throw Error("Firewall state requires saved intent"); continue; }
    if (f.statePolicy?.version !== 1 || requireKnown(f.statePolicy.idleTimeout, "us") !== saved.idleTimeoutSeconds * 1000000) throw Error("Firewall idle timeout must match saved intent");
  }
  for (const r of resources.filter(r => r.firewallState !== undefined)) if (r.type !== "Firewall" || !input.systems.firewalls.some(f => f.id === r.id)) throw Error("Firewall state requires its owned Firewall engine");
}
