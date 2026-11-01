/** Optional application CPU-time budget owned by a request-serving VM. */
export interface VmCpuQuota { version: 1; limitPercent: number }
export const VM_CPU_LIMIT_MAX = 100;
export const VM_CPU_QUOTA_PERIOD_US = 100000;
export const VM_CPU_QUOTA_HELP = "Application CPU limit. The simulator gives this VM a CPU-time budget in each quota window. When the budget is used up, runnable work waits until the next window.";

export function vmCpuQuotaError(type: string, value: unknown, asyncWorkerEnabled = false): string | undefined {
  if (value === undefined) return;
  if (type !== "Virtual Machine") return "Application CPU limit belongs to a request-serving Virtual Machine.";
  if (asyncWorkerEnabled) return "This VM runs queue jobs; clear Application CPU limit before enabling Background worker.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Application CPU limit requires an explicit version.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return "Application CPU limit requires version 1.";
  if (Object.keys(v).some(k => !["version", "limitPercent"].includes(k))) return "Application CPU limit contains unsupported settings.";
  if (typeof v.limitPercent !== "number" || !Number.isSafeInteger(v.limitPercent) || v.limitPercent < 1 || v.limitPercent > VM_CPU_LIMIT_MAX) return `Application CPU limit must be an integer from 1 to ${VM_CPU_LIMIT_MAX}.`;
}
