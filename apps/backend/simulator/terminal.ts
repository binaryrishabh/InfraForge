import { prisma } from "../lib/prisma";
import type { RunAction } from "../lib/generated/prisma/client";
import { storedJson } from "../utils/json";
import { captureSnapshot } from "./snapshot";
import { flushAcknowledgement } from "./actionAcknowledgement";
import type { SimulationInstance } from "./instance";
import { publishSimulationSnapshot } from "../infra/pubsub";
import { redis } from "../infra/redis";
import { Publish } from "@infraforge/contracts/events";
import { flushEvidence } from "../evidence/persist";

export async function finishTeardown(deploymentId: string, instance: SimulationInstance, action: RunAction, remove: () => void,
  providedSnapshot?: ReturnType<typeof captureSnapshot>) {
  await flushEvidence(deploymentId, instance);
  const snapshot = providedSnapshot ?? captureSnapshot(deploymentId, instance, "terminal");
  const capturedAt = new Date(snapshot.capturedAt);
  const stoppedMessage = "Simulation stopped; exact terminal state captured.";
  const failedMessage = "A scenario step failed. This attempt is unscored; start a new attempt.";
  instance.acknowledge = async () => {
    let failedScenario = false;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${deploymentId} FOR UPDATE`;
      const run = await tx.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
      if (run.status === "torn-down" || run.status === "failed") {
        const stored = run.terminalSnapshot as { capturedAt?: string } | null;
        const done = await tx.runAction.findUniqueOrThrow({ where: { id: action.id } });
        if (stored?.capturedAt === snapshot.capturedAt && done.status === "completed") {
          failedScenario = run.status === "failed";
          return;
        }
        throw new Error("Terminal acknowledgement differs from the captured state");
      }
      if (run.status !== "live" || !run.runtimeActive) throw new Error("Run stopped before terminal capture could be persisted");
      // An uncertain scripted application is already closed as a failed durable
      // step. Preserve that failure on the attempt in this same terminal commit.
      failedScenario = run.challengeScenario != null && !!await tx.runAction.findFirst({where: {
        deploymentId, scenarioStepId: {not: null}, status: "failed",
      }});
      await tx.runAction.update({ where: { id: action.id, status: "applying" }, data: { status: "completed",
        appliedAt: capturedAt, completedAt: capturedAt, appliedSimulatedSeconds: snapshot.simulatedSeconds,
        completedSimulatedSeconds: snapshot.simulatedSeconds, outcome: { capturedAt: snapshot.capturedAt, appliedRevision: snapshot.topologyRevision } } });
      await tx.runAction.updateMany({ where: { deploymentId, id: { not: action.id }, status: { in: ["requested", "applying", "running"] } },
        data: { status: "cancelled", completedAt: capturedAt, completedSimulatedSeconds: snapshot.simulatedSeconds,
          failureReason: "Run teardown stopped this unfinished action." } });
      const timeline = Array.isArray(run.timeline) ? run.timeline : [];
      await tx.deployment.update({ where: { id: deploymentId }, data: { terminalSnapshot: storedJson(snapshot),
        status: failedScenario ? "failed" : "torn-down", runtimeActive: false, timeline: [...timeline, { timestamp: snapshot.capturedAt,
          event: failedScenario ? "Deployment Failed" : "Deployment Torn Down", message: failedScenario ? failedMessage : stoppedMessage }] } });
    });
    // Retrying this same acknowledgement also sends the final notification.
    // Optional Redis delivery cannot invalidate the committed database evidence.
    await publishSimulationSnapshot(snapshot).catch(() => {});
    await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({ deploymentId,
      publishType: failedScenario ? Publish.publishDeploymentFailed : Publish.publishDeploymentTornDown,
      status: failedScenario ? "failed" : "torn-down", timestamp: snapshot.capturedAt,
      message: failedScenario ? failedMessage : stoppedMessage })).catch(() => {});
    remove();
  };
  await flushAcknowledgement(instance);
  return snapshot;
}
