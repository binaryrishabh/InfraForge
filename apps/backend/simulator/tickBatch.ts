import type { SimulationInstance } from "./instance";
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
// The next submitted browser action is due: the batch stops at its second so it is applied there.
export function replayDue(instance: SimulationInstance) {
  const r = instance.replay;
  return !!r && r.next < r.actions.length && currentSecond(instance) >= r.actions[r.next]!.atSecond;
}
export async function advanceTickBatch(instance: SimulationInstance, complete: (instance: SimulationInstance) => Promise<void>, stopped = () => false,
  persist?: (instance: SimulationInstance) => Promise<void>) {
  if (instance.evidence?.captureError) throw instance.evidence.captureError;
  await persist?.(instance);
  const started = performance.now();
  for (let i = 0; i < instance.speed && !stopped() && !reachedMatchedStop(instance) && !experimentDue(instance) && !replayDue(instance); i++) {
    const remaining = MODEL2_BATCH_BUDGET_MS - (performance.now() - started);
    // Catching up after an action uses the same budget; the run resumes once it is caught up.
    if ((i > 0 && remaining <= 0) || !instance.model2.catchUp(Math.max(0, remaining))) break;
    instance.pendingLogs.push(...instance.model2.advance());
    instance.accumulatedCostUsd += instance.model2.burnRatePerHourUsd() / 3600;
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
