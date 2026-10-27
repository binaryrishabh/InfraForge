import { buildPoolSnapshots } from "@infraforge/simulation/engine";
import type { ActionOutcome } from "@infraforge/contracts/actions";
import type { SimulationInstance, RunningAction } from "./instance";

// A Model 2 replica change that has not settled after this many simulated seconds is reported as not observed.
const MODEL2_POOL_SETTLE_SECONDS = 300;
function model2Completion(instance: SimulationInstance, running: RunningAction) {
  const engine = instance.model2!, { request, outcome } = running, now = engine.simulatedSeconds;
  if (request.kind === "chaos" && now >= running.endSecond!) {
    return { status: "completed" as const, outcome: { ...outcome, faultEnded: true, observedOverallHealth: engine.view().overallHealth } };
  }
  if (request.kind === "pool-scale") {
    const settled = engine.poolSettled(request.parameters.lbId, running.previousReplicas!, request.parameters.delta);
    if (settled !== null) return { status: "completed" as const, outcome: { ...outcome, finalReplicaCount: settled } };
    if (now - running.appliedSecond! >= MODEL2_POOL_SETTLE_SECONDS) return { status: "failed" as const, outcome, failureReason: "The expected replica change was not observed." };
  }
  return null;
}

export function actionCompletion(instance: SimulationInstance, running: RunningAction):
  { status: "completed" | "failed" | "cancelled"; outcome: ActionOutcome; failureReason?: string } | null {
  if (instance.model2) return model2Completion(instance, running);
  const state = instance.state!;
  const { request, outcome } = running;
  if ((request.kind === "chaos" || request.kind === "vertical-scale") && !state.resourceTypes[request.parameters.resourceId]) {
    return { status: "cancelled", outcome, failureReason: "Topology removed the target before this action finished." };
  }
  if (request.kind === "chaos" && state.simulatedSeconds >= running.endSecond!) {
    return { status: "completed", outcome: { ...outcome, faultEnded: true, observedOverallHealth: state.overallHealth } };
  }
  if (request.kind === "vertical-scale" && !state.verticalScaling.some((v) => v.resourceId === request.parameters.resourceId)) {
    const { resourceId, skuId } = request.parameters;
    if (state.resourceSkus[resourceId]?.skuId !== skuId) return { status: "failed", outcome, failureReason: "Requested SKU was not installed." };
    // The last restart tick still has offline measurements. Wait for a tick that observes it online.
    if (state.metrics[resourceId]?.health && state.metrics[resourceId]!.health !== "failed") {
      return { status: "completed", outcome: { ...outcome, installedSkuId: skuId, online: true } };
    }
  }
  if (request.kind === "pool-scale") {
    const { lbId, delta } = request.parameters;
    const pool = state.pools[lbId];
    if (!pool) return { status: "cancelled", outcome, failureReason: "Topology removed the pool before scaling finished." };
    const replica = state.spawnedVms.find((v) => v.id === running.replicaId);
    const complete = delta === 1 ? replica?.status === "active" : !replica;
    if (complete && !pool.pending) return { status: "completed", outcome: { ...outcome,
      finalReplicaCount: buildPoolSnapshots(state).pools[lbId]!.currentReplicas } };
    if (!pool.pending) return { status: "failed", outcome, failureReason: "The expected replica transition was not observed." };
  }
  return null;
}
