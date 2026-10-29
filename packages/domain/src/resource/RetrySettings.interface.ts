export const RETRY_GROUPS = ["connectionFailure", "timeout", "overload", "backendFailure"] as const;
export type RetryGroup = typeof RETRY_GROUPS[number];

/** Saved intent; values are required when enabled, never injected into old saves. */
export interface RetrySettings {
  enabled: boolean;
  maxAttempts?: number;
  backoffMs?: number;
  jitterRatio?: number;
  maxConcurrentRetries?: number;
  retryOn?: RetryGroup[];
}

export const DEFAULT_RETRY_SETTINGS: RetrySettings = {
  enabled: true, maxAttempts: 2, backoffMs: 100, jitterRatio: 0.2,
  maxConcurrentRetries: 4, retryOn: ["connectionFailure", "timeout"],
};

/** Shared by saved-layout admission and direct browser/compiler callers. */
export function retrySettingsError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Load Balancer") return "Retry settings belong only to a load balancer";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid retry settings";
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((k) => !["enabled", "maxAttempts", "backoffMs", "jitterRatio", "maxConcurrentRetries", "retryOn"].includes(k)) || typeof p.enabled !== "boolean") return "Invalid retry setting";
  for (const [key, min, max, integer] of [["maxAttempts", 1, 5, true], ["backoffMs", 1, 5000, true], ["jitterRatio", 0, 1, false], ["maxConcurrentRetries", 1, 64, true]] as const) {
    const n = p[key];
    if (n === undefined && !p.enabled) continue;
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) return `Invalid retry ${key}: expected ${min} to ${max}`;
  }
  if (p.retryOn === undefined && !p.enabled) return;
  if (!Array.isArray(p.retryOn) || (p.enabled && !p.retryOn.length) || new Set(p.retryOn).size !== p.retryOn.length || p.retryOn.some((g) => !RETRY_GROUPS.includes(g))) return "Choose at least one valid retry failure group when enabled";
}
