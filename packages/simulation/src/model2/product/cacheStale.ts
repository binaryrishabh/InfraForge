import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const CACHE_STALE_PROFILE = "cache-stale/1" as const;
export const changedCacheStale = (r: Resource) => r.type === "Cache" && r.cachePolicy?.staleSeconds !== undefined;
export const cacheStaleChanges = (resources: readonly Resource[]) => resources.some(changedCacheStale);

type Q = (id: string, value: number, unit: "us", sentence?: string, authored?: boolean) => Quantity<"us">;
/** Optional fields appear only for marked designs, so unmarked cache and aside bytes stay identical. */
export const cacheStaleField = (r: Resource, q: Q) => r.cachePolicy?.staleSeconds === undefined ? {}
  : { staleFor: q(`${r.id}.cachePolicy.staleSeconds`, r.cachePolicy.staleSeconds * 1000000, "us", "Saved bound on how long after expiry a retained body may answer a caller whose database fill failed; such answers are counted as stale.", true) };
export const asideStaleField = (cache: Resource) => cache.cachePolicy?.staleSeconds === undefined ? {} : { staleOnError: true as const };

export function validateCacheStaleBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(x => x.type === "Cache")) {
    const cache = input.resources.find(c => c.id === r.id);
    const saved = r.cachePolicy?.staleSeconds;
    if (cache?.kind !== "cache") throw Error("Cache stale policy requires its owned keyed cache");
    if ((saved === undefined) !== (cache.staleFor === undefined) || (saved !== undefined && requireKnown(cache.staleFor!, "us") !== saved * 1000000)) throw Error("Cache stale bound must match saved intent");
    for (const aside of input.resources.filter(c => c.kind === "cache-aside" && c.cache === r.id)) {
      if (aside.kind === "cache-aside" && (aside.staleOnError === true) !== (saved !== undefined)) throw Error("Stale-on-error must match saved intent on every aside using this cache");
    }
  }
}
