import type { Resource } from "@infraforge/domain/resource";
import type { SystemsInput } from "../systems/contracts";

export const CACHE_INVALIDATION_PROFILE = "cache-invalidation/1" as const;
/** Marked means the saved write policy is present with either value; marking both values keeps a one-change pair on one adapter selection. */
export const changedCacheInvalidation = (r: Resource) => r.type === "Cache" && r.cachePolicy?.invalidateOnWrite !== undefined;
export const cacheInvalidationChanges = (resources: readonly Resource[]) => resources.some(changedCacheInvalidation);

/** Unmarked caches keep the previous aside bytes exactly: invalidateWrites true and no freshness field. */
export const asideInvalidationFields = (cache: Resource) => cache.cachePolicy?.invalidateOnWrite === undefined ? { invalidateWrites: true as const }
  : { invalidateWrites: cache.cachePolicy.invalidateOnWrite, trackFreshness: true as const };

/** Freshness is measured against one committed writer: a replicated or read-routed database is refused rather than guessed. */
export const cacheInvalidationRefusal = (cache: Resource, database: Resource) => changedCacheInvalidation(cache) && (database.databaseReplication !== undefined || database.databaseReadRouting !== undefined)
  ? "A saved cache write policy needs a database without replication or read routing; freshness is measured against one committed writer." : undefined;

export function validateCacheInvalidationBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(x => x.type === "Cache")) {
    const saved = r.cachePolicy?.invalidateOnWrite;
    for (const aside of input.resources.filter(c => c.kind === "cache-aside" && c.cache === r.id)) {
      if (aside.kind !== "cache-aside") continue;
      if (saved === undefined ? aside.invalidateWrites !== true || aside.trackFreshness !== undefined : aside.invalidateWrites !== saved || aside.trackFreshness !== true) throw Error("Cache write invalidation must match saved intent on every aside using this cache");
    }
  }
}
