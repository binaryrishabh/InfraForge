import { findSku } from "@infraforge/catalog";
import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import type { ComputeResource, ComputeProfile } from "../compute/contracts";
import type { SystemsInput } from "../systems/contracts";
import type { ProductContract } from "./contracts";
import type { Resource } from "@infraforge/domain/resource";
export const VM_MEMORY_PROFILE = "vm-memory/1" as const;
export const changedVmMemory = (r: Resource) => r.type === "Virtual Machine" && r.vmMemory !== undefined;
export const vmMemoryChanges = (resources: readonly Resource[]) => resources.some(changedVmMemory);

const MiB = 1048576;
export const vmMemoryLimit = (r: Resource) => (r.skuId ? findSku(r.skuId)!.ramGb : { small: 2, medium: 4, large: 8 }[r.size ?? "small"]) * 1073741824;
export function memoryBytes(amount: number) {
  const bytes = amount * MiB;
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error("Modeled resident byte accounting overflow");
  return bytes;
}
type QuantityBuilder = <U extends Unit>(id: string, value: number, unit: U, sentence?: string, authored?: boolean) => Quantity<U>;
export function vmMemorySettings(r: Resource, role: string, q: QuantityBuilder): { memory?: ComputeResource["memory"] } {
  if (!changedVmMemory(r) || role !== "main" || r.asyncWorker?.enabled) return {};
  return { memory: { coverage: "complete-model", policy: "reject-allocation",
    baseline: q(`${r.id}.vmMemory.baselineMiB`, memoryBytes(r.vmMemory!.baselineMiB), "bytes", "Modeled resident memory (from your numbers): authored baseline MiB converted to bytes.", true),
    limit: q(`${r.id}.memory.limit`, vmMemoryLimit(r), "bytes", "catalog label interpreted as GiB; only the authored baseline and per-request amounts are counted") } };
}
export function bindVmMemoryProfiles(resources: readonly Resource[], contract: ProductContract, q: QuantityBuilder) {
  for (const r of resources.filter(changedVmMemory)) {
    const node = contract.nodes[r.id]!, config = node.resources.find(v => v.role === "main")!.config;
    if (config.kind !== "compute") throw Error("Modeled memory requires its request-serving Virtual Machine compute engine");
    node.profileVersion += `/${VM_MEMORY_PROFILE}`; node.provenance.push(`saved-design:${r.id}.vmMemory`);
    const requestResidentBytes = q(`${r.id}.vmMemory.requestMiB`, memoryBytes(r.vmMemory!.requestMiB), "bytes", "Modeled resident memory (from your numbers): held by every admitted request, including queued requests, until it finishes.", true);
    const activeResidentBytes = q(`${r.id}.vmMemory.activeMiB`, memoryBytes(r.vmMemory!.activeMiB), "bytes", "Modeled resident memory (from your numbers): extra held throughout active execution, including dependency waits.", true);
    for (const [operation, baseId] of Object.entries(config.profiles)) {
      const base = contract.application!.demands.find(p => p.id === baseId);
      if (base?.schema !== "infraforge-compute-demand/1") throw Error("Modeled memory requires a compute demand for every operation");
      const id = `${r.id}.vmMemory.${operation}`;
      contract.application!.demands.push({ ...base, id, residentCoverage: "complete-model", requestResidentBytes, activeResidentBytes });
      config.profiles[operation] = id;
    }
  }
}
export function validateVmMemoryBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedVmMemory)) {
    const replicas = input.resources.filter(d => d.id === r.id || (d.id.startsWith(`${r.id}#`) && !d.id.includes("/")));
    if (!replicas.length || r.asyncWorker?.enabled) throw Error("Modeled memory requires its request-serving Virtual Machine compute engine");
    for (const app of replicas) {
      if (app.kind !== "compute") throw Error("Modeled memory requires a compute endpoint");
      const m = app.memory, v = r.vmMemory!;
      if (m.coverage !== "complete-model" || m.policy !== "reject-allocation" || !m.baseline || !m.limit || m.perWorker || m.retained || m.components ||
        requireKnown(m.baseline, "bytes") !== memoryBytes(v.baselineMiB) || requireKnown(m.limit, "bytes") !== vmMemoryLimit(r)) throw Error("Modeled memory must match saved baseline, catalog limit and allocation policy");
      for (const id of Object.values(app.profiles)) {
        const p = input.profiles.find(p => p.id === id) as ComputeProfile | undefined;
        if (!p || p.residentCoverage !== "complete-model" || !p.requestResidentBytes || !p.activeResidentBytes || p.residentComponents ||
          requireKnown(p.requestResidentBytes, "bytes") !== memoryBytes(v.requestMiB) || requireKnown(p.activeResidentBytes, "bytes") !== memoryBytes(v.activeMiB)) throw Error("Modeled memory operation amounts must match saved intent");
      }
    }
  }
}
