/** Optional generic cache-aside settings, owned by the Cache resource. */
export interface CachePolicy { version: 1; ttlSeconds?: number; singleFlight?: boolean }

export const CACHE_TTL_MAX_SECONDS = 3600;
export function cachePolicyError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Cache") return "Cache policy belongs to a Cache.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Cache policy requires version 1.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || Object.keys(v).some(k => !["version", "ttlSeconds", "singleFlight"].includes(k))) return "Cache policy requires version 1 and only TTL and single-flight settings.";
  if (v.ttlSeconds !== undefined && (typeof v.ttlSeconds !== "number" || !Number.isSafeInteger(v.ttlSeconds) || v.ttlSeconds < 1 || v.ttlSeconds > CACHE_TTL_MAX_SECONDS)) return `Cache TTL must be an integer from 1 to ${CACHE_TTL_MAX_SECONDS} seconds.`;
  if (v.singleFlight !== undefined && typeof v.singleFlight !== "boolean") return "Cache single-flight must be on or off.";
}
