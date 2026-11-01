import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const CDN_TTL_PROFILE = "cdn-ttl/1" as const;
export const cdnTtlChanges = (resources: readonly Resource[]) => resources.some(r => r.cdnCachePolicy?.ttlSeconds !== undefined);
type QuantityBuilder = (id: string, value: number, unit: "us", sentence?: string, authored?: boolean) => Quantity<"us">;
export function cdnTtl(r: Resource, q: QuantityBuilder) {
  const seconds = r.cdnCachePolicy?.ttlSeconds;
  return seconds === undefined ? q(`${r.id}.ttl`, 60000000, "us")
    : q(`${r.id}.ttl`, seconds * 1000000, "us", "Saved educational CDN cache TTL in seconds converted to microseconds; freshness starts at each successful origin fill, not at a hit. This is not a provider guarantee.", true);
}
export function validateCdnTtlBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(r => r.cdnCachePolicy !== undefined)) {
    const cdn = input.resources.find(d => d.id === r.id);
    if (r.type !== "CDN" || cdn?.kind !== "cdn") throw Error("Cache TTL requires its owned CDN engine");
    if (requireKnown(cdn.ttl, "us") !== r.cdnCachePolicy!.ttlSeconds * 1000000) throw Error("CDN TTL must match saved intent");
  }
}
