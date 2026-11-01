/** Freshness policy owned by a CDN; omission keeps the historical 60 seconds. */
export type CdnCachePolicy = { version: 1; ttlSeconds: number } | { version: 2; ttlSeconds?: number; coalesce: boolean; maxWaiters?: number };
export const CDN_MAX_WAITERS = 100000;
export const CDN_COALESCING_HELP = "When several requests miss the same object at the same time, coalescing lets them share one origin fetch.";
export const CDN_WAITERS_HELP = "Maximum requests allowed to share one in-progress origin fetch. Extra requests are refused while that fill is full.";
export const CDN_TTL_MAX_SECONDS = 3600;
export const CDN_TTL_HELP = "How long a cached object stays fresh. After it expires, the next request must fetch from the origin again.";
export const CDN_TTL_SCOPE = "This is an educational CDN cache policy, not a provider guarantee.";

export function cdnCachePolicyError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "CDN") return "Cache TTL belongs to a CDN.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Cache TTL requires an explicit version.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1 && v.version !== 2) return "Cache TTL requires version 1 or 2.";
  if (v.version === 2) {
    if (Object.keys(v).some(k => !["version", "ttlSeconds", "coalesce", "maxWaiters"].includes(k))) return "CDN policy contains unsupported settings.";
    if (typeof v.coalesce !== "boolean") return "CDN coalescing requires On or Off.";
    if (v.maxWaiters !== undefined && (!v.coalesce || typeof v.maxWaiters !== "number" || !Number.isSafeInteger(v.maxWaiters) || v.maxWaiters < 1 || v.maxWaiters > CDN_MAX_WAITERS)) return `Shared-fill request limit requires coalescing On and an integer from 1 to ${CDN_MAX_WAITERS}.`;
    if (v.ttlSeconds === undefined) return;
  }
  if (v.version === 1 && Object.keys(v).some(k => !["version", "ttlSeconds"].includes(k))) return "Cache TTL contains unsupported settings.";
  if (typeof v.ttlSeconds !== "number" || !Number.isSafeInteger(v.ttlSeconds) || v.ttlSeconds < 1 || v.ttlSeconds > CDN_TTL_MAX_SECONDS) return `Cache TTL must be an integer from 1 to ${CDN_TTL_MAX_SECONDS} seconds.`;
}
