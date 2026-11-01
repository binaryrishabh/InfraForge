/** Optional application request admission limits owned by a request-serving VM. */
export interface VmExecution { version: 1; workers?: number; queuedRequests?: number }
export const VM_WORKERS_MAX = 512;
export const VM_QUEUED_REQUESTS_MAX = 1000;

export function vmExecutionError(type: string, value: unknown, asyncWorkerEnabled = false): string | undefined {
  if (value === undefined) return;
  if (type !== "Virtual Machine") return "VM execution belongs to a Virtual Machine.";
  if (asyncWorkerEnabled) return "This VM runs queue jobs; clear VM execution settings before enabling Background worker.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "VM execution requires an explicit version.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return "VM execution requires version 1.";
  if (Object.keys(v).some(k => !["version", "workers", "queuedRequests"].includes(k))) return "VM execution contains unsupported settings.";
  for (const [field, min, max] of [["workers", 1, VM_WORKERS_MAX], ["queuedRequests", 0, VM_QUEUED_REQUESTS_MAX]] as const) {
    const n = v[field];
    if (n !== undefined && (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max)) return `${field} must be an integer from ${min} to ${max}.`;
  }
}
