import { CAPACITY, modeledResourceSizing } from "@infraforge/simulation/capacity";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";

export function declaredCapacity(resource: Resource) {
  if (resource.type === RESOURCE_TYPES.VirtualMachine || resource.type === RESOURCE_TYPES.Database) {
    const sizing = modeledResourceSizing(resource);
    return { value: sizing?.cores ?? null, unit: sizing?.cores === 1 ? "modeled CPU core" : "modeled CPU cores" };
  }
  return { value: CAPACITY[resource.type]?.rps ?? null, unit: resource.type === RESOURCE_TYPES.Database ? "qps" : "rps" };
}

// Bar colour follows the model's thresholds; the number is always printed beside it.
export function meterTone(value: number) {
  return value >= SIMULATION_CONSTANTS.SATURATED_AT ? "bg-hot" : value >= SIMULATION_CONSTANTS.DEGRADED_AT ? "bg-warn" : "bg-ok";
}
