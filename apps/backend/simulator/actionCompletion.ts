import { buildPoolSnapshots } from "@infraforge/simulation/engine";
import type { ActionOutcome } from "@infraforge/contracts/actions";
import type { SimulationInstance, RunningAction } from "./instance";

export function actionCompletion(instance: SimulationInstance, running: RunningAction):
  { status: "completed" | "failed" | "cancelled"; outcome: ActionOutcome; failureReason?: string } | null {
  const { state } = instance;
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
