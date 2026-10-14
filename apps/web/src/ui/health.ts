export type HealthState = "healthy" | "degraded" | "saturated" | "failed" | "critical" | "unknown";
export const LABEL: Record<HealthState, string> = { healthy: "Healthy", degraded: "Degraded", saturated: "Saturated", failed: "Failed", critical: "Critical", unknown: "Unknown" };
export const COLOR: Record<HealthState, string> = { healthy: "text-ok", degraded: "text-warn", saturated: "text-hot", failed: "text-fail", critical: "text-fail", unknown: "text-ink-3" };

export function healthState(value: string | null | undefined): HealthState {
  return value && value in LABEL ? value as HealthState : "unknown";
}
export const healthLabel = (value: string | null | undefined) => LABEL[healthState(value)];
