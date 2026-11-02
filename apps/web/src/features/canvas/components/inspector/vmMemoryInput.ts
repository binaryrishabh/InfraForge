import { VM_MEMORY_MAX_MIB, vmMemoryError, type VmMemory } from "@infraforge/domain/resource";

export type MemoryDraft = Record<"baselineMiB" | "requestMiB" | "activeMiB", string>;
export const memoryDraft = (saved?: VmMemory): MemoryDraft => ({ baselineMiB: saved ? String(saved.baselineMiB) : "", requestMiB: saved ? String(saved.requestMiB) : "", activeMiB: saved ? String(saved.activeMiB) : "" });
export function parseMemoryDraft(draft: MemoryDraft) {
  const errors: Partial<MemoryDraft> = {}, value: VmMemory = { version: 1, baselineMiB: Number(draft.baselineMiB), requestMiB: Number(draft.requestMiB), activeMiB: Number(draft.activeMiB) };
  for (const key of ["baselineMiB", "requestMiB", "activeMiB"] as const) {
    if (draft[key].trim() === "" || !Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > VM_MEMORY_MAX_MIB) errors[key] = "Enter a whole number from 0 to 1,048,576 MiB.";
  }
  if (!Object.keys(errors).length) {
    const error = vmMemoryError("Virtual Machine", value);
    if (error) errors.requestMiB = error;
  }
  return { errors, value: Object.keys(errors).length ? undefined : value };
}
