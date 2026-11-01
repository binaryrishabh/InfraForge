/** Optional admission limits owned by a Load Balancer resource. */
export interface LbAdmission { version: 1; maxActive?: number; maxQueued?: number; queueWaitMs?: number }
// Bounded educational inputs: active covers 64 cores at the existing 1024-per-core default;
// queued matches the network pending budget, and queue wait is capped at one minute.
export const LB_ACTIVE_MAX = 65536;
export const LB_QUEUED_MAX = 100000;
export const LB_QUEUE_WAIT_MAX_MS = 60000;

export function lbAdmissionError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Load Balancer") return "Admission settings belong to a Load Balancer.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Load balancer admission requires an explicit version.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return "Load balancer admission requires version 1.";
  if (Object.keys(v).some(k => !["version", "maxActive", "maxQueued", "queueWaitMs"].includes(k))) return "Load balancer admission contains unsupported settings.";
  for (const [field, min, max] of [["maxActive", 1, LB_ACTIVE_MAX], ["maxQueued", 0, LB_QUEUED_MAX], ["queueWaitMs", 1, LB_QUEUE_WAIT_MAX_MS]] as const) {
    const n = v[field];
    if (n !== undefined && (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max)) return `${field} must be an integer from ${min} to ${max}.`;
  }
}
