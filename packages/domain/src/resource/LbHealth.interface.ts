/** Optional health-check policy owned by a Load Balancer resource. */
export interface LbHealth { version: 1; intervalSeconds?: number; timeoutSeconds?: number; unhealthyAfter?: number; healthyAfter?: number }
// Whole seconds keep the existing microsecond scheduler bounded (at most one probe
// per backend per second). One-minute timers and ten consecutive checks cover the
// 5s/1s/1/1 canvas defaults without unbounded learner waits; these are educational limits.
export const LB_HEALTH_SECONDS_MAX = 60;
export const LB_HEALTH_THRESHOLD_MAX = 10;

export function lbHealthError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Load Balancer") return "Health-check settings belong to a Load Balancer.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Load balancer health requires an explicit version.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return "Load balancer health requires version 1.";
  if (Object.keys(v).some(k => !["version", "intervalSeconds", "timeoutSeconds", "unhealthyAfter", "healthyAfter"].includes(k))) return "Load balancer health contains unsupported settings.";
  for (const [field, max] of [["intervalSeconds", LB_HEALTH_SECONDS_MAX], ["timeoutSeconds", LB_HEALTH_SECONDS_MAX], ["unhealthyAfter", LB_HEALTH_THRESHOLD_MAX], ["healthyAfter", LB_HEALTH_THRESHOLD_MAX]] as const) {
    const n = v[field];
    if (n !== undefined && (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > max)) return `${field} must be an integer from 1 to ${max}.`;
  }
  // The existing engine refuses overlapping probes; omitted controls retain 5s/1s.
  if (((v.timeoutSeconds ?? 1) as number) > ((v.intervalSeconds ?? 5) as number)) return "Health-check timeout must not exceed the interval (defaults: 1 and 5 seconds).";
}
