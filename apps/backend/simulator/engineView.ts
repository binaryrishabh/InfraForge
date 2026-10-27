import { buildPoolSnapshots } from "@infraforge/simulation/engine";
import { computeHourlyBurnRateUsd } from "@infraforge/simulation/cost";
import type { SimulationInstance } from "./instance";

/* The one place that knows which engine a run uses. Snapshots, evidence and actions read the run
through here. When Model 1 is removed, only the Model 2 half remains. */
export function currentSecond(instance: SimulationInstance) {
  return instance.model2 ? instance.model2.simulatedSeconds : instance.state!.simulatedSeconds;
}

export function liveView(instance: SimulationInstance) {
  if (instance.model2) {
    const view = instance.model2.view();
    return { ...view, spawnedVms: [], restarting: [], verticalScaling: [],
      installedSkus: Object.fromEntries(instance.topology.resources.flatMap((r) => r.skuId ? [[r.id, r.skuId]] : [])),
      burnRatePerHourUsd: instance.model2.burnRatePerHourUsd() };
  }
  const state = instance.state!, pools = buildPoolSnapshots(state);
  return { simulatedSeconds: state.simulatedSeconds, loadFraction: state.loadFraction, targetLoadFraction: state.targetLoadFraction,
    metrics: state.metrics, overallHealth: state.overallHealth, pools: pools.pools, spawnedVms: pools.spawnedVms,
    restarting: state.verticalScaling.map((v) => v.resourceId), activeChaos: state.activeChaos, verticalScaling: state.verticalScaling,
    installedSkus: Object.fromEntries(Object.entries(state.resourceSkus).map(([id, sku]) => [id, sku.skuId])),
    burnRatePerHourUsd: computeHourlyBurnRateUsd(state), traffic: undefined };
}
