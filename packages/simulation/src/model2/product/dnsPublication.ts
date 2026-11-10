import { dnsPublicationError, type Resource } from "@infraforge/domain/resource";
import { requireKnown } from "../../reality/quantity";
import type { ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const DNS_PUBLICATION_PROFILE = "dns-publication/1" as const;
export const dnsPublicationChanges = (resources: readonly Resource[]) => resources.some(r => r.dnsPublication !== undefined);
export function validateDnsPublicationProfile(resources: readonly Resource[], contract: ProductContract) {
  if (dnsPublicationChanges(resources) !== contract.version.includes(`/${DNS_PUBLICATION_PROFILE}`)) throw Error("DNS publication requires its captured profile and matching saved intent");
  for (const r of resources) { const error = dnsPublicationError(r.type, r.dnsPublication); if (error) throw Error(error); }
}
/** Select only the captured caller's single route. Never infer a destination from a drawn edge. */
export function publicationBinding(input: SystemsInput, authorityId: string) {
  const authority = input.resources.find(r => r.id === authorityId);
  const resolver = input.resources.find(r => r.kind === "dns-resolver" && r.id === `${authorityId}/resolver` && r.authority === authorityId);
  const dials = input.systems.connections.filter(c => c.dns?.resolver === resolver?.id && input.paths.some(p => p.id === c.path && p.source === "$caller"));
  if (authority?.kind !== "dns-authority" || !authority.publication || authority.publication.version !== 1 || authority.records.length ||
    resolver?.kind !== "dns-resolver" || resolver.publicationEvidence !== true || dials.length !== 1 ||
    dials[0]!.dns!.routes.length !== 1 || input.resources.filter(r => r.kind === "dns-authority").length !== 1) throw Error("DNS publication requires one initially absent owned authority and unambiguous caller DNS route");
  const dns = dials[0]!.dns!, record = authority.publication.record, route = dns.routes[0]!, path = input.paths.find(p => p.id === route.path);
  if (dns.name !== "app.example" || record.name !== dns.name || record.type !== "A" || record.generation !== 1 || record.addresses.length !== 1 ||
    record.addresses[0] !== route.address || requireKnown(record.ttl, "us") !== 60_000_000 || !path || path.source !== "$caller" ||
    !input.operations.some(o => o.entry === path.target && o.id !== input.systems.operation) ||
    !input.systems.identities.some(i => i.id === path.target && i.address === route.address)) throw Error("DNS publication record must match the single captured serving destination");
  return {authority, resolver, record, path: path.id};
}
export function validateDnsPublicationBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(r => r.dnsPublication !== undefined)) publicationBinding(input, r.id);
  for (const r of input.resources) {
    if (r.kind === "dns-authority" && r.publication && !resources.some(s => s.id === r.id && s.dnsPublication)) throw Error("DNS publication requires saved authority intent");
    if (r.kind === "dns-resolver" && r.publicationEvidence && !resources.some(s => `${s.id}/resolver` === r.id && s.dnsPublication)) throw Error("DNS publication requires saved resolver intent");
  }
}
