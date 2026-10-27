import { prisma } from "../lib/prisma";
import { readActionRequest } from "../actions/contract";
import { applyAction } from "./actionApplication";
import { actionCompletion } from "./actionCompletion";
import { acknowledgeAction, flushAcknowledgement } from "./actionAcknowledgement";
import { finishTeardown } from "./terminal";
import { ActionExecutionError, type SimulationInstance } from "./instance";
import { isExperimentAction } from "../challenges/experiment";
import { currentSecond } from "./engineView";

// The experiment's phase follows its one durable row; a failed row is final and is never retried.
function settleExperiment(instance: SimulationInstance, action: { kind: string; parameters: unknown }, applied: boolean) {
  if (instance.experiment && isExperimentAction(action as never)) instance.experiment.phase = applied ? "applied" : "failed";
}

export async function processRunActions(deploymentId: string, instance: SimulationInstance, remove: () => void) {
  await flushAcknowledgement(instance);
  const actions = await prisma.runAction.findMany({ where: { deploymentId, status: { in: ["requested", "applying"] } },
    orderBy: { sequence: "asc" }, take: 128 });
  for (const action of actions) {
    if (action.status === "applying") {
      settleExperiment(instance, action, false);
      await acknowledgeAction(instance, action.id, { status: "failed", completedAt: new Date(),
        failureReason: "Application acknowledgement is unavailable; this action was not replayed." });
      continue;
    }
    const claimed = await prisma.runAction.updateMany({ where: { id: action.id, status: "requested",
      deployment: { status: "live", runtimeActive: true } }, data: { status: "applying" } });
    if (!claimed.count) continue;
    let request;
    try { request = readActionRequest({ kind: action.kind, parameters: action.parameters }); }
    catch {
      settleExperiment(instance, action, false);
      await acknowledgeAction(instance, action.id, { status: "failed", completedAt: new Date(), failureReason: "Stored action parameters are invalid." });
      continue;
    }
    if (request.kind === "teardown") return finishTeardown(deploymentId, instance, action, remove);
    let result;
    try { result = applyAction(instance, action.id, request); }
    catch (error) {
      settleExperiment(instance, action, false);
      await acknowledgeAction(instance, action.id, { status: "failed", completedAt: new Date(),
        completedSimulatedSeconds: currentSecond(instance),
        failureReason: error instanceof ActionExecutionError ? error.message : "Action application could not be established; it will not be replayed." });
      continue;
    }
    // Applied in memory now; a failed acknowledgement freezes this state and is retried, never replayed.
    settleExperiment(instance, action, true);
    const appliedAt = new Date();
    await acknowledgeAction(instance, action.id, { ...result, appliedAt, appliedSimulatedSeconds: currentSecond(instance),
      ...(result.status === "completed" ? { completedAt: appliedAt, completedSimulatedSeconds: currentSecond(instance) } : {}) });
    await recordActionCompletions(instance);
  }
  return null;
}

export async function recordActionCompletions(instance: SimulationInstance) {
  for (const [id, running] of instance.actions) {
    const completion = actionCompletion(instance, running);
    if (!completion) continue;
    await acknowledgeAction(instance, id, { ...completion, completedAt: new Date(), completedSimulatedSeconds: currentSecond(instance) });
    instance.actions.delete(id);
  }
}
