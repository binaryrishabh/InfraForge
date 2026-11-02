import type { Resource } from "@infraforge/domain/resource";
export const VM_MEMORY_PROFILE = "vm-memory/1" as const;
export const changedVmMemory = (r: Resource) => r.type === "Virtual Machine" && r.vmMemory !== undefined;
export const vmMemoryChanges = (resources: readonly Resource[]) => resources.some(changedVmMemory);
