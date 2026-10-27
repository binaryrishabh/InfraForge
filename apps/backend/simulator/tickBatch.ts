import { tick } from "@infraforge/simulation/engine";
import { computeHourlyBurnRateUsd } from "@infraforge/simulation/cost";
import type { SimulationInstance } from "./instance";
import { displaySimulationLogs } from "./logs";
import { captureEvidenceTick } from "../evidence/capture";
import { currentSecond } from "./engineView";

export function reachedMatchedStop(instance: SimulationInstance) {
  return instance.autoStopAtSimulatedSeconds != null && currentSecond(instance) >= instance.autoStopAtSimulatedSeconds;
}
// The scheduled fault is due and not yet applied: the batch must stop exactly at its second.
export function experimentDue(instance: SimulationInstance) {
  const e = instance.experiment;
  return !!e && (e.phase === "scheduled" || e.phase === "requested") && currentSecond(instance) >= e.plan.atSimulatedSecond;
}
// A Model 2 batch stops once it has used this much wall time, so one busy run slows itself down
// instead of delaying the other runs on this worker. The next cycle continues from the same second.
export const MODEL2_BATCH_BUDGET_MS = 600;
export async function advanceTickBatch(instance: SimulationInstance, complete: (instance: SimulationInstance) => Promise<void>, stopped = () => false,
  persist?: (instance: SimulationInstance) => Promise<void>) {
  if (instance.evidence?.captureError) throw instance.evidence.captureError;
  await persist?.(instance);
  const started = performance.now();
  for (let i = 0; i < instance.speed && !stopped() && !reachedMatchedStop(instance) && !experimentDue(instance); i++) {
    if (instance.model2 && i > 0 && performance.now() - started > MODEL2_BATCH_BUDGET_MS) break;
    if (instance.model2) {
      instance.pendingLogs.push(...instance.model2.advance());
      instance.accumulatedCostUsd += instance.model2.burnRatePerHourUsd() / 3600;
    } else {
      const result = tick(instance.state!, {});
      instance.state = result.state;
      instance.pendingLogs.push(...displaySimulationLogs(result.logs));
      instance.accumulatedCostUsd += computeHourlyBurnRateUsd(instance.state) / 3600;
    }
    instance.metricsComputedAt = new Date().toISOString();
    instance.metricsTopologyRevision = instance.topologyRevision;
    instance.tickCount += 1;
    captureEvidenceTick(instance);
    // Completion at the target must be durable before terminal capture.
    await complete(instance);
  }
  await persist?.(instance);
  return reachedMatchedStop(instance);
}
