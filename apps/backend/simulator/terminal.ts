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
  instance.acknowledge = async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${deploymentId} FOR UPDATE`;
      const run = await tx.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
      if (run.status === "torn-down") {
        const stored = run.terminalSnapshot as { capturedAt?: string } | null;
        const done = await tx.runAction.findUniqueOrThrow({ where: { id: action.id } });
        if (stored?.capturedAt === snapshot.capturedAt && done.status === "completed") return;
        throw new Error("Terminal acknowledgement differs from the captured state");
      }
      if (run.status !== "live" || !run.runtimeActive) throw new Error("Run stopped before terminal capture could be persisted");
      await tx.runAction.update({ where: { id: action.id, status: "applying" }, data: { status: "completed",
        appliedAt: capturedAt, completedAt: capturedAt, appliedSimulatedSeconds: snapshot.simulatedSeconds,
        completedSimulatedSeconds: snapshot.simulatedSeconds, outcome: { capturedAt: snapshot.capturedAt, appliedRevision: snapshot.topologyRevision } } });
      await tx.runAction.updateMany({ where: { deploymentId, id: { not: action.id }, status: { in: ["requested", "applying", "running"] } },
        data: { status: "cancelled", completedAt: capturedAt, completedSimulatedSeconds: snapshot.simulatedSeconds,
          failureReason: "Run teardown stopped this unfinished action." } });
      const timeline = Array.isArray(run.timeline) ? run.timeline : [];
      await tx.deployment.update({ where: { id: deploymentId }, data: { terminalSnapshot: storedJson(snapshot),
        status: "torn-down", runtimeActive: false, timeline: [...timeline, { timestamp: snapshot.capturedAt,
          event: "Deployment Torn Down", message: "Simulation stopped; exact terminal state captured." }] } });
    });
    // Retrying this same acknowledgement also sends the final notification.
    // Optional Redis delivery cannot invalidate the committed database evidence.
    await publishSimulationSnapshot(snapshot).catch(() => {});
    await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({ deploymentId,
      publishType: Publish.publishDeploymentTornDown, status: "torn-down", timestamp: snapshot.capturedAt,
      message: "Simulation stopped; exact terminal state captured." })).catch(() => {});
    remove();
  };
  await flushAcknowledgement(instance);
  return snapshot;
}
