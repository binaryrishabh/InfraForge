/** Freshness policy owned by a CDN; omission keeps the historical 60 seconds. */
export interface CdnCachePolicy { version: 1; ttlSeconds: number }
export const CDN_TTL_MAX_SECONDS = 3600;
export const CDN_TTL_HELP = "How long a cached object stays fresh. After it expires, the next request must fetch from the origin again.";
export const CDN_TTL_SCOPE = "This is an educational CDN cache policy, not a provider guarantee.";

export function cdnCachePolicyError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "CDN") return "Cache TTL belongs to a CDN.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Cache TTL requires an explicit version.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return "Cache TTL requires version 1.";
  if (Object.keys(v).some(k => !["version", "ttlSeconds"].includes(k))) return "Cache TTL contains unsupported settings.";
  if (typeof v.ttlSeconds !== "number" || !Number.isSafeInteger(v.ttlSeconds) || v.ttlSeconds < 1 || v.ttlSeconds > CDN_TTL_MAX_SECONDS) return `Cache TTL must be an integer from 1 to ${CDN_TTL_MAX_SECONDS} seconds.`;
}
