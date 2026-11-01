/** Optional generic cache-aside settings, owned by the Cache resource. */
export type CachePolicy = { ttlSeconds?: number; singleFlight?: boolean } & (
  { version: 1 } | { version: 2; capacityEntries: number }
);

export const CACHE_TTL_MAX_SECONDS = 3600;
export const CACHE_CAPACITY_MAX_ENTRIES = 1000;
export function cachePolicyError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Cache") return "Cache policy belongs to a Cache.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Cache policy requires an explicit version.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1 && v.version !== 2) return "Cache policy requires version 1 or 2.";
  const fields = ["version", "ttlSeconds", "singleFlight", ...(v.version === 2 ? ["capacityEntries"] : [])];
  if (Object.keys(v).some(k => !fields.includes(k))) return "Cache policy contains unsupported settings for its version.";
  if (v.version === 2 && (typeof v.capacityEntries !== "number" || !Number.isSafeInteger(v.capacityEntries) || v.capacityEntries < 1 || v.capacityEntries > CACHE_CAPACITY_MAX_ENTRIES)) return `Logical cache capacity must be an integer from 1 to ${CACHE_CAPACITY_MAX_ENTRIES} entries.`;
  if (v.ttlSeconds !== undefined && (typeof v.ttlSeconds !== "number" || !Number.isSafeInteger(v.ttlSeconds) || v.ttlSeconds < 1 || v.ttlSeconds > CACHE_TTL_MAX_SECONDS)) return `Cache TTL must be an integer from 1 to ${CACHE_TTL_MAX_SECONDS} seconds.`;
  if (v.singleFlight !== undefined && typeof v.singleFlight !== "boolean") return "Cache single-flight must be on or off.";
}
