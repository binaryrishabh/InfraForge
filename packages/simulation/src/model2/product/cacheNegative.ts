import type { Resource } from "@infraforge/domain/resource";
import type { Quantity } from "../../reality/quantity";
import { requireKnown } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const CACHE_NEGATIVE_PROFILE = "cache-negative/1" as const;
export const changedCacheNegative = (r: Resource) => r.type === "Cache" && r.cachePolicy?.negativeTtlSeconds !== undefined;
export const cacheNegativeChanges = (resources: readonly Resource[]) => resources.some(r => changedCacheNegative(r) || r.dataKeyspace?.absentCount !== undefined);
export const asideNegativeField = (r: Resource) => changedCacheNegative(r) ? { negativeCaching: r.cachePolicy!.negativeTtlSeconds! > 0 } : {};
export function cacheNegativeField(r: Resource, q: (id: string, n: number, unit: "us", sentence: string, saved: boolean) => Quantity<"us">) {
  return changedCacheNegative(r) ? { negativeTtl: q(`${r.id}.negativeTtl`, r.cachePolicy!.negativeTtlSeconds! * 1_000_000, "us", "Saved lifetime for explicit successful empty query results; zero disables caching absence. Failures are never absence.", true) } : {};
}
/** V1 has a static dataset. Inserts, mutable-data freshness, replicas and typed flows need a separate absence visibility contract. */
export function cacheNegativeRefusal(resources: readonly Resource[], readWriteRatio: number | undefined): string | undefined {
  if (!cacheNegativeChanges(resources)) return;
  if (readWriteRatio !== 1) return "Negative caching and an initially absent dataset support read-only workloads; insertion and mutable absence visibility are not modeled.";
  if (resources.some(r => r.applicationFlow || r.rowLocking || r.databaseReplication || r.databaseReadRouting || (changedCacheNegative(r) && (r.cachePolicy?.staleSeconds !== undefined || r.cachePolicy?.invalidateOnWrite !== undefined)))) return "Negative caching supports plain read-only cache-aside paths without typed flows, row locking, replication, read routing, stale fallback or write freshness tracking.";
}
export function validateCacheNegativeBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const cache of resources.filter(r => r.type === "Cache")) {
    const ttl = cache.cachePolicy?.negativeTtlSeconds;
    for (const c of input.resources) {
      if (c.kind === "cache" && c.id === cache.id && (ttl === undefined ? c.negativeTtl !== undefined : !c.negativeTtl || requireKnown(c.negativeTtl, "us") !== ttl * 1_000_000)) throw Error("Negative cache lifetime must match saved intent");
      if (c.kind === "cache-aside" && c.cache === cache.id && (ttl === undefined ? c.negativeCaching !== undefined : c.negativeCaching !== (ttl > 0))) throw Error("Negative cache policy must match saved intent on every targeting helper");
    }
  }
}
