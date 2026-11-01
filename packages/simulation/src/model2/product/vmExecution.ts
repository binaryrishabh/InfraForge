import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const VM_EXECUTION_PROFILE = "vm-execution/1" as const;
export const changedVmExecution = (r: Resource) => r.type === "Virtual Machine" && (r.vmExecution?.workers !== undefined || r.vmExecution?.queuedRequests !== undefined);
export const vmExecutionChanges = (resources: readonly Resource[]) => resources.some(changedVmExecution);

type QuantityBuilder = (id: string, value: number, unit: "count", sentence?: string, authored?: boolean) => Quantity<"count">;
function limit(r: Resource, role: string, field: "workers" | "queuedRequests", fallback: number, q: QuantityBuilder) {
  const value = r.type === "Virtual Machine" && role === "main" && !r.asyncWorker?.enabled ? r.vmExecution?.[field] : undefined;
  const id = `${r.id}.${role}.${field === "workers" ? "workers" : "queue"}`;
  return value === undefined ? q(id, fallback, "count") : q(id, value, "count", field === "workers"
    ? "Saved educational application worker slots; CPU capacity is unchanged."
    : "Saved request queue capacity; waiting requests use this queue and a full VM refuses new work.", true);
}
export const vmWorkers = (r: Resource, role: string, cores: number, q: QuantityBuilder) => limit(r, role, "workers", cores * 4, q);
export const vmQueuedRequests = (r: Resource, role: string, q: QuantityBuilder) => limit(r, role, "queuedRequests", 256, q);

export function validateVmExecutionBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedVmExecution)) {
    const replicas = input.resources.filter(d => d.id === r.id || (d.id.startsWith(`${r.id}#`) && !d.id.includes("/")));
    if (!replicas.length || r.asyncWorker?.enabled || replicas.some(d => d.kind !== "compute")) throw Error("VM execution requires its owned request-serving compute engine");
    for (const app of replicas) {
      if (app.kind !== "compute") throw Error("VM execution requires a compute endpoint");
      if ((r.vmExecution!.workers !== undefined && requireKnown(app.workers, "count") !== r.vmExecution!.workers) ||
          (r.vmExecution!.queuedRequests !== undefined && requireKnown(app.queueCapacity, "count") !== r.vmExecution!.queuedRequests)) throw Error("VM worker and queue limits must match saved execution intent");
    }
  }
}
