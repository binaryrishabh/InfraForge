import type { ActionOutcome } from "@infraforge/contracts/actions";
import type { SimulationInstance, RunningAction } from "./instance";

// A Model 2 replica change that has not settled after this many simulated seconds is reported as not observed.
const MODEL2_POOL_SETTLE_SECONDS = 300;
export function actionCompletion(instance: SimulationInstance, running: RunningAction):
  { status: "completed" | "failed" | "cancelled"; outcome: ActionOutcome; failureReason?: string } | null {
  const engine = instance.model2, { request, outcome } = running, now = engine.simulatedSeconds;
  if (request.kind === "intervention" && now >= running.endSecond!) {
    return {status: "completed", outcome: {...outcome, interventionEnded: true}};
  }
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

