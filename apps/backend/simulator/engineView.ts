import type { SimulationInstance } from "./instance";

/* Snapshots, evidence and actions read the run through here. */
export function currentSecond(instance: SimulationInstance) {
  return instance.model2.simulatedSeconds;
}

export function liveView(instance: SimulationInstance) {
  const view = instance.model2.view();
  return { ...view, spawnedVms: [], restarting: [], verticalScaling: [],
    installedSkus: Object.fromEntries(instance.topology.resources.flatMap((r) => r.skuId ? [[r.id, r.skuId]] : [])),
    burnRatePerHourUsd: instance.model2.burnRatePerHourUsd() };
}
