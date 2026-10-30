import { dueScenarioSteps } from "@infraforge/simulation/model2-run";
import { prisma } from "../lib/prisma";
import { storedJson } from "../utils/json";
import type { SimulationInstance } from "./instance";
import { currentSecond } from "./engineView";
import { flushEvidence } from "../evidence/persist";

// Establish each due row before applying it. A lost transaction reply is safe: uniqueness
// finds that same row on retry. Pending rows freeze batching until their acknowledgement.
export async function establishScenario(deploymentId: string, instance: SimulationInstance) {
  const scenario = instance.scenario;
  if (!scenario) return;
  const second = currentSecond(instance);
  for (const step of dueScenarioSteps(scenario.plan, scenario.next, second)) {
    if (step.atSecond !== second) throw Error("The scenario boundary was skipped; advancement is frozen.");
    await flushEvidence(deploymentId, instance);
    const status = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${deploymentId} FOR UPDATE`;
      const run = await tx.deployment.findUniqueOrThrow({where: {id: deploymentId}});
      if (run.status !== "live" || !run.runtimeActive) throw Error("Run stopped before its scenario step.");
      const existing = await tx.runAction.findUnique({where: {deploymentId_scenarioStepId: {deploymentId, scenarioStepId: step.id}}});
      if (existing) return existing.status;
      const sequenced = await tx.deployment.update({where: {id: deploymentId}, data: {actionSequence: {increment: 1}}});
      await tx.runAction.create({data: {deploymentId, sequence: sequenced.actionSequence, scenarioStepId: step.id,
        kind: "intervention", parameters: storedJson(step.request)}});
      return "requested";
    });
    if (status === "requested" || status === "applying") scenario.pending.add(step.id);
    scenario.next++;
  }
}
