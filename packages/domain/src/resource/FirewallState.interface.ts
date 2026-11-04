/** Optional semantic connection tracking. Omission preserves historical captures. */
export interface FirewallState { version: 1; idleTimeoutSeconds: number }
export const FIREWALL_IDLE_SECONDS_MAX = 3600;
export const FIREWALL_STATE_HELP = "Forget a tracked connection after this many seconds without a modeled request or response. Established flows bypass new rules and capacity checks until expiry; the next request is evaluated as new. Blank keeps historical tracking until close. No packet model.";
export function firewallStateError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Firewall") return "Connection state belongs to Firewall.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Connection state requires version 1 and idleTimeoutSeconds.";
  const p = value as Record<string, unknown>;
  if (p.version !== 1 || Object.keys(p).some(k => !["version", "idleTimeoutSeconds"].includes(k))) return "Connection state requires version 1 with only its own fields.";
  if (typeof p.idleTimeoutSeconds !== "number" || !Number.isSafeInteger(p.idleTimeoutSeconds) || p.idleTimeoutSeconds < 1 || p.idleTimeoutSeconds > FIREWALL_IDLE_SECONDS_MAX) return `Idle timeout must be an integer from 1 to ${FIREWALL_IDLE_SECONDS_MAX} seconds.`;
}
