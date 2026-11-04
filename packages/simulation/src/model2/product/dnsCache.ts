import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const DNS_CACHE_PROFILE = "dns-cache/1" as const;
export const dnsCacheChanges = (resources: readonly Resource[]) => resources.some(r => r.dnsCachePolicy !== undefined);
type QuantityBuilder = (id: string, value: number, unit: "us", sentence?: string, authored?: boolean) => Quantity<"us">;
export function dnsCache(r: Resource, q: QuantityBuilder) {
  return r.dnsCachePolicy === undefined ? {} : { cachePolicy: { version: 1 as const,
    maxTtl: q(`${r.id}.resolver.maxTtl`, r.dnsCachePolicy.maxTtlSeconds * 1000000, "us", "Saved educational resolver TTL ceiling for positive and negative answers, measured from receipt and bounded by the authority expiry. No health detection, record update or connection migration is implied.", true) } };
}
export function validateDnsCacheBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const resolver of input.resources.filter(r => r.kind === "dns-resolver")) {
    if (resolver.kind !== "dns-resolver") continue;
    const owner = resources.find(r => `${r.id}/resolver` === resolver.id);
    const saved = owner?.dnsCachePolicy;
    if (saved === undefined) { if (resolver.cachePolicy !== undefined) throw Error("Resolver TTL ceiling requires saved DNS intent"); continue; }
    if (owner?.type !== "DNS" || resolver.cachePolicy?.version !== 1 || requireKnown(resolver.cachePolicy.maxTtl, "us") !== saved.maxTtlSeconds * 1000000) throw Error("Resolver TTL ceiling must match saved DNS intent");
  }
  for (const r of resources.filter(r => r.dnsCachePolicy !== undefined)) {
    if (r.type !== "DNS" || !input.resources.some(d => d.kind === "dns-resolver" && d.id === `${r.id}/resolver`)) throw Error("Resolver TTL ceiling requires its owned DNS resolver");
  }
}
