import { prisma } from "../lib/prisma";
import { EXPERIMENT_TRIGGER } from "../challenges/experiment";
import type { SimulationInstance } from "./instance";
import { flushEvidence } from "../evidence/persist";

/* Makes a resilience attempt's scheduled fault durable at exactly its second. The
row is written once (a unique index allows only one per attempt), then the normal
action path applies it at the same simulated second. If the write cannot be
established the run stays frozen at this second and retries; it never advances
past the experiment point or applies the fault without its record. */
export async function establishExperiment(deploymentId: string, instance: SimulationInstance) {
  const experiment = instance.experiment;
  if (!experiment || experiment.phase !== "scheduled" || instance.state.simulatedSeconds < experiment.plan.atSimulatedSecond) return;
  await flushEvidence(deploymentId, instance);
  const { plan } = experiment;
  const status = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${deploymentId} FOR UPDATE`;
    const run = await tx.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
    if (run.status !== "live" || !run.runtimeActive) throw new Error("Run stopped before its scheduled experiment");
    // A lost reply may follow a committed insert: the existing row is the experiment.
    const existing = await tx.runAction.findFirst({ where: { deploymentId, kind: "chaos", parameters: { path: ["trigger"], equals: EXPERIMENT_TRIGGER } } });
    if (existing) return existing.status;
    const sequenced = await tx.deployment.update({ where: { id: deploymentId }, data: { actionSequence: { increment: 1 } } });
    await tx.runAction.create({ data: { deploymentId, sequence: sequenced.actionSequence, kind: "chaos", requestedAt: new Date(),
      parameters: { type: plan.fault, resourceId: plan.targetResourceId, trigger: EXPERIMENT_TRIGGER } } });
    return "requested";
  });
  experiment.phase = status === "requested" || status === "applying" ? "requested" : "failed";
}
