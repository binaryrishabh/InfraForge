import { tick } from "@infraforge/simulation/engine";
import { computeHourlyBurnRateUsd } from "@infraforge/simulation/cost";
import type { SimulationInstance } from "./instance";
import { displaySimulationLogs } from "./logs";

export function reachedMatchedStop(instance: SimulationInstance) {
  return instance.autoStopAtSimulatedSeconds != null && instance.state.simulatedSeconds >= instance.autoStopAtSimulatedSeconds;
}
// The scheduled fault is due and not yet applied: the batch must stop exactly at its second.
export function experimentDue(instance: SimulationInstance) {
  const e = instance.experiment;
  return !!e && (e.phase === "scheduled" || e.phase === "requested") && instance.state.simulatedSeconds >= e.plan.atSimulatedSecond;
}
export async function advanceTickBatch(instance: SimulationInstance, complete: (instance: SimulationInstance) => Promise<void>, stopped = () => false) {
  for (let i = 0; i < instance.speed && !stopped() && !reachedMatchedStop(instance) && !experimentDue(instance); i++) {
    const result = tick(instance.state, {});
    instance.state = result.state;
    instance.metricsComputedAt = new Date().toISOString();
    instance.metricsTopologyRevision = instance.topologyRevision;
    instance.tickCount += 1;
    instance.pendingLogs.push(...displaySimulationLogs(result.logs));
    instance.accumulatedCostUsd += computeHourlyBurnRateUsd(instance.state) / 3600;
    // Completion at the target must be durable before terminal capture.
    await complete(instance);
  }
  return reachedMatchedStop(instance);
}
