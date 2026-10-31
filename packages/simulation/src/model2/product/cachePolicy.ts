import type { Resource } from "@infraforge/domain/resource";
import { requireKnown } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const CACHE_POLICY_PROFILE = "data-cache-policy/1" as const;
export const changedCacheTtl = (r: Resource) => r.type === "Cache" && r.cachePolicy?.ttlSeconds !== undefined && r.cachePolicy.ttlSeconds !== 60;
// Runnable canvas caches already require either their own aside or an app-owned aside.
export const changedCachePolicy = (r: Resource) => changedCacheTtl(r) || (r.type === "Cache" && r.cachePolicy?.singleFlight === true);
export const cachePolicyChanges = (resources: readonly Resource[]) => resources.some(changedCachePolicy);

export function validateCachePolicyBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(r => r.cachePolicy !== undefined)) {
    const cache = input.resources.find(c => c.id === r.id);
    if (cache?.kind !== "cache" || requireKnown(cache.ttl, "us") !== (r.cachePolicy!.ttlSeconds ?? 60) * 1000000) throw Error("Cache TTL must match saved seconds on its owned keyed cache");
    for (const aside of input.resources.filter(c => c.kind === "cache-aside" && c.cache === r.id)) {
      if (aside.kind === "cache-aside" && aside.coalesce !== (r.cachePolicy!.singleFlight ?? false)) throw Error("Single-flight must match saved intent on every aside using this cache");
    }
  }
}
