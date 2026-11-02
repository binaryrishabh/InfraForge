/** Authored resident amounts for the request-serving application on a VM. */
export interface VmMemory { version: 1; baselineMiB: number; requestMiB: number; activeMiB: number }
export const VM_MEMORY_MAX_MIB = 1048576;
export const VM_MEMORY_HELP = "A model built from your numbers: baseline + each request + extra while running, compared with the instance's catalog memory. Requests that would not fit are refused. It does not model an OOM kill, swapping or garbage collection.";
export function vmMemoryError(type: string, value: unknown, asyncWorkerEnabled = false): string | undefined {
  if (value === undefined) return;
  if (type !== "Virtual Machine") return "Modeled memory belongs to a request-serving Virtual Machine, including application-flow and upload-producer VMs; Background worker VMs are unsupported.";
  if (asyncWorkerEnabled) return "This VM runs queue jobs; clear Modeled memory before enabling Background worker.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Modeled memory requires explicit version 1 and three amounts.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return "Modeled memory requires version 1.";
  if (Object.keys(v).some(k => !["version", "baselineMiB", "requestMiB", "activeMiB"].includes(k))) return "Modeled memory contains unsupported settings.";
  for (const key of ["baselineMiB", "requestMiB", "activeMiB"] as const) {
    const amount = v[key];
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0 || amount > VM_MEMORY_MAX_MIB) return `Modeled memory ${key} must be an integer from 0 to ${VM_MEMORY_MAX_MIB} MiB.`;
  }
  if (v.requestMiB === 0 && v.activeMiB === 0) return "Modeled memory must grow: per-request MiB or extra while running MiB must be greater than zero.";
}
