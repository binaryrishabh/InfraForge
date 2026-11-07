import type { ActionRequest } from "@infraforge/contracts/actions";
import type { RunAction } from "../lib/generated/prisma/client";
import type { SimulationInstance } from "../simulator/instance";
import type { StoredRun } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import { storedJson } from "../utils/json";
import { databaseLayout, databaseWorkload, promoteRequest } from "./databaseReplication.fixture";

// Free World regression evidence only. These live actions are not an authored
// challenge script, a published lab or a learner-editable challenge solution.
export function promotionInput(delay = 1) {
  return captureRunInputs(databaseLayout(delay, "primary"), {...databaseWorkload, readWriteRatio: 0}, "lb14-promotion");
}
export function promotionActions(promoteAt: number | null, outage: "primary" | "replica" = "primary") {
  const actions: Array<{atSecond: number; request: ActionRequest}> = [
    {atSecond: 1, request: {kind: "intervention", parameters: {interventionId: `db-fail-${outage}`, revision: 1, target: {resourceId: "db"}, parameters: {duration: 5}}}},
  ];
  if (promoteAt !== null) actions.push({atSecond: promoteAt, request: promoteRequest});
  return actions;
}
export function promotionRun(promoteAt: number | null, delay = 1, outage: "primary" | "replica" = "primary") {
  const input = promotionInput(delay), run = createModel2Engine(input, 8);
  const instance: SimulationInstance = {model2: run, tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: input, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: null, metricsTopologyRevision: 0};
  const actions: RunAction[] = [], samples = [];
  for (let second = 1; second <= 8; second++) {
    run.advance(); instance.tickCount = second; instance.metricsComputedAt = new Date().toISOString();
    samples.push({view: run.view(), evidence: run.evidence()});
    for (const [id, running] of instance.actions) {
      const done = actionCompletion(instance, running);
      if (!done) continue;
      Object.assign(actions.find(a => a.id === id)!, {status: done.status, outcome: storedJson(done.outcome), completedAt: new Date(), completedSimulatedSeconds: second});
      instance.actions.delete(id);
    }
    for (const action of promotionActions(promoteAt, outage).filter(a => a.atSecond === second)) {
      const id = `action-${actions.length + 1}`, applied = applyAction(instance, id, action.request);
      actions.push({id, deploymentId: "promotion-regression", sequence: actions.length + 1, scenarioStepId: null,
        kind: action.request.kind, parameters: storedJson(action.request.parameters) as RunAction["parameters"], status: applied.status,
        requestedAt: new Date(), appliedAt: new Date(), completedAt: applied.status === "completed" ? new Date() : null,
        appliedSimulatedSeconds: second, completedSimulatedSeconds: applied.status === "completed" ? second : null,
        outcome: storedJson(applied.outcome) as RunAction["outcome"], failureReason: null});
    }
  }
  const row: StoredRun = {id: "promotion-regression", infrastructureId: null, runName: "Writer promotion regression",
    status: "torn-down", runtimeActive: false, resourceCount: input.resources.length, createdAt: new Date(), updatedAt: new Date(),
    topologyRevision: 0, stages: [], timeline: [], chaosEvents: [], workloadProfile: input.workloadProfile, seed: input.seed,
    runInputs: input, liveTopology: {resources: input.resources, connectionLines: input.connectionLines}, simulationState: null,
    terminalSnapshot: storedJson(captureSnapshot("promotion-regression", instance, "terminal")), actions};
  return {row, samples};
}
