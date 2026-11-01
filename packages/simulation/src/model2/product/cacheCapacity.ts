import type { Resource } from "@infraforge/domain/resource";
import { requireKnown } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const CACHE_CAPACITY_PROFILE = "data-cache-capacity/1" as const;
export const MODELED_ROW_BYTES = 1024;
export const MODELED_CACHE_ENTRY_OVERHEAD_BYTES = 64;
export const changedCacheCapacity = (r: Resource) => r.type === "Cache" && r.cachePolicy?.version === 2;
export const cacheCapacityChanges = (resources: readonly Resource[]) => resources.some(changedCacheCapacity);

export function validateCacheCapacityBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedCacheCapacity)) {
    if (r.cachePolicy?.version !== 2) continue;
    const entries = r.cachePolicy.capacityEntries;
    const cache = input.resources.find(c => c.id === r.id);
    if (cache?.kind !== "cache" || cache.policy !== "lru") throw Error("Logical capacity requires its owned keyed LRU cache");
    const capacity = requireKnown(cache.capacity, "bytes"), overhead = requireKnown(cache.entryOverhead, "bytes");
    const asides = input.resources.filter(c => c.kind === "cache-aside" && c.cache === r.id);
    if (!asides.length) throw Error("Logical capacity requires a modeled database-backed cache");
    for (const aside of asides) {
      if (aside.kind !== "cache-aside") continue;
      const database = input.resources.find(d => d.id === aside.database);
      if (database?.kind !== "relational" || !database.initial.length || database.initial.some(row => capacity !== entries * (requireKnown(row.bytes, "bytes") + overhead))) throw Error("Logical capacity must equal saved entries times modeled row bytes plus per-entry overhead");
    }
  }
}
