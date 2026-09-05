/* InfraForge live cost model — pure, deterministic, ZERO I/O.
Cost is a pure function of simulated time (Locked Decision #8).
The burn rate derives from the SKU catalog; resources without a SKU
fall back to a labelled generic estimate. */
import { RESOURCE_TYPES } from "../constants/RESOURCE_TYPES.constants";
import type { SimulationState } from "../interface/SimulationState.interface";

// Transitional fallback for resources without a selected SKU.
// Mirrors the deployment-time cost estimate. OWNER: keep in sync with
// real provider pricing as the SKU catalog expands.
export const GENERIC_MONTHLY_USD: Record<string, number> = {
  [RESOURCE_TYPES.DNS]: 3,
  [RESOURCE_TYPES.CDN]: 10,
  [RESOURCE_TYPES.Firewall]: 10,
  [RESOURCE_TYPES.LoadBalancer]: 20,
  [RESOURCE_TYPES.VirtualMachine]: 15,
  [RESOURCE_TYPES.ContainerRegistry]: 15,
  [RESOURCE_TYPES.Cache]: 25,
  [RESOURCE_TYPES.Database]: 40,
  [RESOURCE_TYPES.MessageQueue]: 30,
  [RESOURCE_TYPES.ObjectStorage]: 5,
  [RESOURCE_TYPES.MonitoringAgent]: 8,
};

const HOURS_PER_MONTH = 730;

/* Hourly burn rate of the CURRENTLY RUNNING infrastructure.
Iterates the engine's live resource set, so active autoscaled replicas
are included and drained ones are excluded automatically. */
export const computeHourlyBurnRateUsd = (state: SimulationState): number => {
  let monthlyTotal = 0;
  for (const resourceId of Object.keys(state.resourceTypes)) {
    const sku = state.resourceSkus[resourceId];
    const type = state.resourceTypes[resourceId]!;
    const monthlyUsd = sku
      ? sku.monthlyPriceUsd
      : (GENERIC_MONTHLY_USD[type] ?? 10);
    monthlyTotal += monthlyUsd;
  }
  return monthlyTotal / HOURS_PER_MONTH;
};