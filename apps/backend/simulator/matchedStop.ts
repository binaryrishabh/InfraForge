import { prisma } from "../lib/prisma";
import type { SimulationInstance } from "./instance";
import { captureSnapshot } from "./snapshot";
import { finishTeardown } from "./terminal";
import { publishSimulationSnapshot } from "../infra/pubsub";
import { redis } from "../infra/redis";
import { Publish } from "@infraforge/contracts/events";

async function claimTeardown(deploymentId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${deploymentId} FOR UPDATE`;
    const run = await tx.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
    if (run.status !== "live" || !run.runtimeActive) throw new Error("Run stopped before matched-stop acknowledgement");
    // A user stop already queued at the horizon wins its audit identity; never duplicate it.
    const existing = await tx.runAction.findFirst({ where: { deploymentId, kind: "teardown", status: { in: ["requested", "applying", "running"] } } });
    if (existing) return existing.status === "requested" ? tx.runAction.update({ where: { id: existing.id }, data: { status: "applying" } }) : existing;
    const sequence = await tx.deployment.update({ where: { id: deploymentId }, data: { actionSequence: { increment: 1 } } });
    const action = await tx.runAction.create({ data: { deploymentId, sequence: sequence.actionSequence, kind: "teardown", parameters: { trigger: "matched-stop" } } });
    return tx.runAction.update({ where: { id: action.id }, data: { status: "applying" } });
  });
}
export async function finishMatchedStop(deploymentId: string, instance: SimulationInstance, remove: () => void) {
  if (!instance.finishMatchedStop) {
    // Capture once even if creating the system action fails. Retain this closure while frozen.
    const snapshot = captureSnapshot(deploymentId, instance, "terminal");
    instance.finishMatchedStop = async () => {
      const action = await claimTeardown(deploymentId);
      await finishTeardown(deploymentId, instance, action, remove, snapshot);
      await publishSimulationSnapshot(snapshot).catch(() => {});
      await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({ deploymentId,
        publishType: Publish.publishDeploymentTornDown, status: "torn-down", timestamp: snapshot.capturedAt,
        message: "Simulation stopped at its matched target; exact terminal state captured." })).catch(() => {});
    };
  }
  await instance.finishMatchedStop();
}
