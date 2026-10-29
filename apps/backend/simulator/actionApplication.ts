import type { ActionOutcome, ActionRequest } from "@infraforge/contracts/actions";
import { ActionExecutionError, type SimulationInstance } from "./instance";
import { ActionRefused } from "./model2Engine";

// Speed stays with the run; everything else goes to the engine, which refuses plainly what it cannot model.
export function applyAction(instance: SimulationInstance, id: string, request: ActionRequest): { status: "running" | "completed"; outcome: ActionOutcome } {
  const engine = instance.model2;
  if (request.kind === "speed") {
    const outcome = { previousSpeed: instance.speed, appliedSpeed: request.parameters.speed };
    instance.speed = request.parameters.speed;
    return { status: "completed", outcome };
  }
  if (request.kind === "teardown") throw new ActionExecutionError("Teardown requires the terminal-snapshot transaction.");
  let applied;
  try { applied = engine.apply(request); }
  catch (error) { if (error instanceof ActionRefused) throw new ActionExecutionError(error.message); throw error; }
  if (request.kind === "load") instance.pendingLogs.push({ timestamp: new Date().toISOString(), source: "load-tester", severity: request.parameters.targetLoadFraction > 1 ? "warn" : "info",
    message: `Load target applied at ${Math.round(request.parameters.targetLoadFraction * 100)}% of declared workload.` });
  if (request.kind === "chaos" || (request.kind === "intervention" && applied.endSecond !== undefined)) { instance.actions.set(id, { id, request, outcome: applied.outcome, endSecond: applied.endSecond }); return { status: "running", outcome: applied.outcome }; }
  if (request.kind === "pool-scale") {
    const previousReplicas = (applied.outcome as { previousReplicaCount: number }).previousReplicaCount;
    instance.actions.set(id, { id, request, outcome: applied.outcome, previousReplicas, appliedSecond: engine.simulatedSeconds });
    return { status: "running", outcome: applied.outcome };
  }
  return { status: "completed", outcome: applied.outcome };
}
