/** Optional saved choice of what the pool controller measures. Omission keeps the direct signal.
 * "observed-core-time" reads only samples that a named Monitoring Agent's backend has received. */
export interface AutoscalingSignal { version: 1; source: "observed-core-time"; monitorId: string; freshForSeconds: number; stale: "hold" }
export const AUTOSCALING_FRESH_MAX_SECONDS = 60;
export const AUTOSCALING_SIGNAL_HELP = "The controller scales only on measurements the named Monitoring Agent's backend has received within this age. Missing, old or incomplete measurements hold the current desired count.";

/** Shape check only; whether the named agent exists and observes the pool is checked against the design. */
export function autoscalingSignalError(policy: { enabled?: boolean; signal?: unknown } | undefined): string | undefined {
  const value = policy?.signal;
  if (value === undefined) return;
  if (policy?.enabled !== true) return "An autoscaling signal needs enabled autoscaling.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Autoscaling signal must be an object.";
  const s = value as Record<string, unknown>;
  if (s.version !== 1 || s.source !== "observed-core-time" || s.stale !== "hold" || Object.keys(s).some(k => !["version", "source", "monitorId", "freshForSeconds", "stale"].includes(k))) return "Autoscaling signal must be version 1, observed-core-time, stale hold, with only a monitor and a freshness bound.";
  if (typeof s.monitorId !== "string" || !s.monitorId.length || s.monitorId.length > 64) return "Autoscaling signal must name one Monitoring Agent.";
  if (typeof s.freshForSeconds !== "number" || !Number.isSafeInteger(s.freshForSeconds) || s.freshForSeconds < 1 || s.freshForSeconds > AUTOSCALING_FRESH_MAX_SECONDS) return `Autoscaling freshness must be an integer from 1 to ${AUTOSCALING_FRESH_MAX_SECONDS} seconds.`;
}
