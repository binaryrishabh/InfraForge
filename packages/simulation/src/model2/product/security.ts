import type { Resource } from "@infraforge/domain/resource";
import { requireKnown } from "../../reality/quantity";
import type { FirewallRule, Scope } from "../systems/contracts";
import type { NodeContract } from "./contracts";
import { canonical } from "./provenance";

/** Refuse forged/mismatched intent before granting the deliberate missing-listener exception. */
export function validateSecurityBinding(r: Resource, n: NodeContract) {
  const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  if (r.listenerSettings !== undefined || n.listenerIntent !== undefined) {
    if (!same(r.listenerSettings, n.listenerIntent)) throw Error(`Listener intent must match saved ports for ${r.id}`);
    for (const { role } of n.resources) {
      const rows = n.listeners.filter(l => l.role === role);
      if (rows.some(l => l.protocol !== "tcp" || l.tls !== "plaintext") || !same(rows.map(l => requireKnown(l.port, "count")).sort((a,b) => a-b), [...r.listenerSettings!.ports].sort((a,b) => a-b))) throw Error(`Explicit listeners must match saved ports for ${r.id}/${role}`);
    }
  }
  if (r.firewallSettings) {
    const p = r.firewallSettings;
    const rules = n.firewall?.rules.map(v => ({ id: v.id, priority: requireKnown(v.priority, "count"), direction: v.direction, source: v.source.kind === "any" ? "any" : v.source.kind === "identity" ? v.source.value?.slice(1) : null, destination: v.destination.kind === "any" ? "any" : v.destination.kind === "identity" ? v.destination.value?.slice(1) : null, fromPort: requireKnown(v.fromPort, "count"), toPort: requireKnown(v.toPort, "count"), action: v.action }));
    const sorted = [...p.rules].sort((a,b) => a.priority-b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (n.firewall?.default !== p.default || !same(rules, sorted) || n.firewall?.rules.some(v => v.protocol !== "tcp")) throw Error(`Firewall policy must match saved rules for ${r.id}`);
  }
}

/** Expand canvas scopes to every replica/helper identity; engine scopes stay exact identities. */
export function expandFirewallRules(rules: FirewallRule[], roleIds: ReadonlyMap<string, string>): FirewallRule[] {
  const scopes = (s: Scope): Scope[] => {
    if (s.kind === "any") return [s];
    const node = s.value!.slice(1);
    const ids = [...new Set([...roleIds.entries()].filter(([key]) => key.split("/")[0]!.split("#")[0] === node).map(([,id]) => id))].sort();
    if (!ids.length) throw Error(`Firewall scope has no runtime identity: ${node}`);
    return ids.map(value => ({ kind: "identity", value }));
  };
  const out: FirewallRule[] = [];
  for (const r of rules) {
    const sources = scopes(r.source), destinations = scopes(r.destination);
    for (const [i, source] of sources.entries()) for (const [j, destination] of destinations.entries()) {
      if (out.length >= 10000) throw Error("Expanded firewall exceeds 10000 runtime rules");
      out.push({ ...r, id: sources.length * destinations.length === 1 ? r.id : `${r.id}~${i}~${j}`, source, destination });
    }
  }
  return out;
}
