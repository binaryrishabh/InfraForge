export interface DnsCachePolicy { version: 1; maxTtlSeconds: number }
export const DNS_CACHE_MAX_TTL_SECONDS = 3600;
export const DNS_CACHE_HELP = "Caps how long this simulated resolver caches positive or missing-name answers; a shorter authority TTL still wins. Record changes wait for expiry, and existing connections keep their destination. Blank uses the authority TTL.";

export function dnsCachePolicyError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "DNS") return "Resolver cache policy belongs to DNS.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "DNS cache policy requires version 1.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || Object.keys(v).some(k => !["version", "maxTtlSeconds"].includes(k))) return "DNS cache policy requires version 1 and supported settings.";
  if (typeof v.maxTtlSeconds !== "number" || !Number.isSafeInteger(v.maxTtlSeconds) || v.maxTtlSeconds < 1 || v.maxTtlSeconds > DNS_CACHE_MAX_TTL_SECONDS) return `DNS cache TTL ceiling must be an integer from 1 to ${DNS_CACHE_MAX_TTL_SECONDS} seconds.`;
}
