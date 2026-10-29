export interface CircuitBreakerSettings {
  enabled: boolean;
  failureThreshold?: number;
  cooldownMs?: number;
}
export const DEFAULT_CIRCUIT_BREAKER_SETTINGS: CircuitBreakerSettings = { enabled: true, failureThreshold: 3, cooldownMs: 1000 };
export function circuitBreakerSettingsError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Load Balancer") return "Circuit breaker settings belong only to a load balancer";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid circuit breaker settings";
  const p = value as Record<string, unknown>;
  if (typeof p.enabled !== "boolean" || Object.keys(p).some((key) => !["enabled", "failureThreshold", "cooldownMs"].includes(key))) return "Invalid circuit breaker setting";
  for (const [key, min, max] of [["failureThreshold", 1, 100], ["cooldownMs", 1, 60000]] as const) {
    const n = p[key]; if (n === undefined && !p.enabled) continue;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max) return `Invalid circuit breaker ${key}: expected ${min} to ${max}`;
  }
}
