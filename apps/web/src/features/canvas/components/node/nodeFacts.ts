import { findSku } from "@infraforge/catalog";
import { CAPACITY } from "@infraforge/simulation/capacity";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";

export function declaredCapacity(resource: Resource) {
  const sku = resource.skuId ? findSku(resource.skuId) : undefined;
  const vm = resource.type === RESOURCE_TYPES.VirtualMachine;
  if (sku) return { value: Math.round(sku.vCpu * sku.baselineFactor * (vm ? SIMULATION_CONSTANTS.RPS_PER_VCPU : SIMULATION_CONSTANTS.QPS_PER_VCPU)), unit: vm ? "rps" : "qps" };
  return { value: CAPACITY[resource.type].rps, unit: resource.type === RESOURCE_TYPES.Database ? "qps" : "rps" };
}

// Bar colour follows the model's thresholds; the number is always printed beside it.
export function meterTone(value: number) {
  return value >= SIMULATION_CONSTANTS.SATURATED_AT ? "bg-hot" : value >= SIMULATION_CONSTANTS.DEGRADED_AT ? "bg-warn" : "bg-ok";
}
