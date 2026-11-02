export interface LbRateLimit { version: 1; burstRequests: number; sustainedRequestsPerSecond: number }
export const LB_RATE_BURST_MAX = 100000;
export const LB_RATE_MIN_RPS = 0.001;
export const LB_RATE_MAX_RPS = 1000000;

export function lbRateLimitError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Load Balancer") return "Rate limiting belongs to a Load Balancer.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Load balancer rate limit requires version 1.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || Object.keys(v).some(k => !["version", "burstRequests", "sustainedRequestsPerSecond"].includes(k))) return "Load balancer rate limit requires strict version 1 settings.";
  if (typeof v.burstRequests !== "number" || !Number.isSafeInteger(v.burstRequests) || v.burstRequests < 1 || v.burstRequests > LB_RATE_BURST_MAX) return `Burst requests must be an integer from 1 to ${LB_RATE_BURST_MAX}.`;
  if (typeof v.sustainedRequestsPerSecond !== "number" || !Number.isFinite(v.sustainedRequestsPerSecond) || v.sustainedRequestsPerSecond < LB_RATE_MIN_RPS || v.sustainedRequestsPerSecond > LB_RATE_MAX_RPS) return `Sustained requests per second must be from ${LB_RATE_MIN_RPS} to ${LB_RATE_MAX_RPS}.`;
}
