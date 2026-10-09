import { Worker } from "bullmq";
import { redis } from "./infra/redis";
import { prisma } from "./lib/prisma";
import { deploymentQueue } from "./infra/queue";
import {
  publishChaosInjected,
  publishDeploymentLive,
  publishDeploymentFailed,
  publishDeploymentStarted,
  publishOutboxFailed,
  publishStageCompleted,
} from "./infra/pubsub";
import {
  startSimulation,
  startRuntime,
  stopRuntime,
} from "./simulator/simulator";
import { WorkerOwnership } from "./infra/workerOwnership";
import { config } from "./utils/config";
import { retireInterruptedRuns, QUARANTINED_RUN_MESSAGE } from "./deployments/restartPolicy";
import { readRunInputs } from "./deployments/runInputs";
import { runSecurityScan } from "./stages/securityScan.stages";
import { runCostEstimation } from "./stages/costEstimation.stages";
import { OutboxBullMQStatus } from "./types/OutboxBullMQStatus.enum";
import { DeploymentStatus } from "@infraforge/contracts/deployment";
import { DeploymentStageStatus } from "@infraforge/contracts/deployment";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import type { OutboxPayload } from "./types/OutboxPayload.interface";
import type { DeploymentJob } from "./types/DeploymentJob.interface";
import type { DeploymentStages } from "@infraforge/contracts/deployment";
import type { DeploymentTimeline } from "@infraforge/contracts/deployment";
import { deploymentFailureStatus, isRetiredDeployment } from "./utils/deploymentJobPolicy";

if (!config.DATABASE_URL) throw new Error("Worker requires DATABASE_URL");
const ownership = await WorkerOwnership.acquire(config.DATABASE_URL, () => {
  stopRuntime();
  console.error("Worker ownership lost. Stopping before another worker can advance simulations.");
  process.exit(1);
});
await retireInterruptedRuns();
await startRuntime(ownership);

/*
What setInterval is doing:- OUTBOX PROCESSOR

Polls the outbox table every 5 seconds. Processes pending entries.
Two delivery paths:

1. "deployment-created"  →  BullMQ queue  →  Worker runs 3 real gates
2. "chaos-injected"      →  Redis Pub/Sub  →  WebSocket clients directly

Why: Chaos events don't need BullMQ processing. They just need real-time
notification. Skipping BullMQ reduces latency and keeps the queue clean.

Later Production upgrade path: Replace polling with CDC (Debezium + Kafka).
*/
async function pollOutbox() {
  let busy = false;
  try {
    await ownership.assertHeld();
    // 1. FETCH — Get up to 10 unprocessed entries, ordered by fewest retries first
    const unprocessed = await prisma.outbox.findMany({
      where: {
        status: OutboxBullMQStatus.PENDING,
      },
      orderBy: [
        { retries: "asc" }, // Entries with fewest retries get priority
        { createdAt: "asc" }, // Older entries first
      ],
      take: 10,
    });

    // 2. PROCESS — Handle each entry
    for (const entry of unprocessed) {
      try {
        // a. Publish based on event type i.e. it's a chaos or deployment?
        if (entry.eventType === "chaos-injected") {
          // Chaos injected events, publish directly to Redis Pub/Sub.
          // No BullMQ needed just real-time notification that a chaos has been injected.
          await publishChaosInjected(
            entry as unknown as { payload: OutboxPayload },
          );
        } else {
          // Add Deployment to BullMQ queue for worker to process it.
          // jobId = deploymentId ensures idempotency, duplicates are ignored by BullMQ automatically, ensures processing only once at max.
          await deploymentQueue.add(entry.eventType, entry.payload, {
            jobId: (entry.payload as unknown as OutboxPayload).deploymentId,
          });
        }

        // b. Mark as completed adding to queue for deployment and publishing to redis pub/sub for chaos injection succeeded
        await prisma.outbox.update({
          where: { id: entry.id },
          data: {
            status: OutboxBullMQStatus.COMPLETED,
            processedAt: new Date(),
          },
        });
      } catch (err: any) {
        // c. Adding to queue or publishing to publisher failed, retry or abandon it
        const newRetries = entry.retries + 1;
        const isFailed = newRetries >= entry.maxRetries;

        // Update retry count and status
        await prisma.outbox.update({
          where: { id: entry.id },
          data: {
            status: isFailed
              ? OutboxBullMQStatus.FAILED
              : OutboxBullMQStatus.PENDING,
            retries: newRetries,
            error: err.message,
          },
        });

        // If permanently failed, mark deployment as failed and notify
        if (isFailed) {
          try {
            if (entry.eventType === "deployment-created") {
              const failure = await prisma.deployment.updateMany({
                where: {
                  id: (entry.payload as unknown as OutboxPayload).deploymentId,
                  status: { in: [DeploymentStatus.PENDING, DeploymentStatus.RUNNING] },
                },
                data: { status: DeploymentStatus.FAILED },
              });
              if (failure.count > 0) {
                await publishOutboxFailed(
                  (entry.payload as unknown as OutboxPayload).deploymentId,
                  "Outbox delivery exhausted all retries.",
                );
              }
            }
          } catch (sideEffectErr: any) {
            console.error(
              `Failure handling failed for outbox ${entry.id}: ${sideEffectErr.message}`,
            );
          }
          console.error(
            `Outbox ${entry.id} | deployment ${(entry.payload as unknown as OutboxPayload).deploymentId} | PERMANENTLY FAILED | ${err.message}`,
          );
        } else {
          console.error(
            `Outbox ${entry.id} | deployment ${(entry.payload as unknown as OutboxPayload).deploymentId} | Retry ${newRetries}/${entry.maxRetries} already done | ${err.message}`,
          );
        }
      }
    }
    busy = unprocessed.length > 0;
  } catch (err: any) {
    // Outer catch — errors here don't crash the poller. Next interval retries.
    console.error(`Outbox poller error: ${err.message}`);
  } finally {
    // Adaptive scheduling — Neon relief (Challenge C3): busy = fast re-poll
    // (1s) so queued work moves quickly; idle = back off (5s) so the
    // serverless DB can auto-suspend. The error path keeps the idle
    // interval so a transient failure never becomes a hot polling loop.
    setTimeout(pollOutbox, busy ? 1000 : 5000);
  }
}

pollOutbox();

const worker = new Worker(
  "deployments", // Watches the "deploymets" queue
  async (job) => {
    // This function runs for every job
    const { deploymentId } = job.data as DeploymentJob;

    try {
      await ownership.assertHeld();
      // 1. Mark deployment as running
      const deploymentState = await prisma.deployment.findUnique({
        where: {
          id: deploymentId,
        },
        include: { infrastructure: { select: { ownerId: true } } },
      });

      if (!deploymentState) {
        // If deployment with specified deploymentId doesn't exists
        console.error(
          `Deployment ${deploymentId} not found in DB. Skipping stage.`,
        );
        return;
      }

      if (isRetiredDeployment(deploymentState.status)) {
        console.log(`Deployment ${deploymentId} is ${deploymentState.status}. Skipping.`);
        return;
      }

      if (deploymentState.status === DeploymentStatus.LIVE) {
        // A LIVE duplicate never initializes/reset a simulation. Restart policy
        // retires interrupted runs before any jobs can be consumed.
        return;
      }

      let inputs;
      try {
        if (!deploymentState.infrastructure.ownerId) throw new Error(QUARANTINED_RUN_MESSAGE);
        inputs = readRunInputs(deploymentState.runInputs);
      }
      catch (error) {
        const message = error instanceof Error ? error.message : "Unsupported run inputs";
        await prisma.deployment.updateMany({
          where: { id: deploymentId, status: { in: [DeploymentStatus.PENDING, DeploymentStatus.RUNNING] } },
          data: { status: DeploymentStatus.FAILED, timeline: [
            ...(Array.isArray(deploymentState.timeline) ? deploymentState.timeline : []),
            { timestamp: new Date().toISOString(), event: "Deployment Failed", message },
          ] },
        });
        await publishDeploymentFailed(deploymentId, message);
        return;
      }
      const { resources, connectionLines } = inputs;

      if (deploymentState.status !== DeploymentStatus.RUNNING) {
        const claimed = await prisma.deployment.updateMany({
          where: {
            id: deploymentId,
            status: DeploymentStatus.PENDING,
          },
          data: {
            status: DeploymentStatus.RUNNING,
          },
        });
        if (claimed.count !== 1) return;
      }

      // Publish as current deployment has started running
      await publishDeploymentStarted(deploymentId, resources.length);
      console.log(`Deployment started ${deploymentId}`);

      // 2. Three REAL gates — the nine-stage theater is retired (Decision 27/32).
      // Each gate runs genuine logic, records one stage entry + one timeline
      // entry, and broadcasts its result. Zero sleeps, zero pretending.
      const runGate = async (
        stageName: DeploymentStages["name"],
        execute: () => {
          status: "passed" | "warning" | "failed";
          summary: string;
          details: Record<string, any>;
        },
      ): Promise<boolean> => {
        // Read fresh stages + timeline for idempotent retries and to avoid stale data
        const currentDeployment = await prisma.deployment.findUnique({
          where: { id: deploymentId },
          select: { stages: true, timeline: true },
        });

        if (!currentDeployment) {
          console.error(
            `Deployment ${deploymentId} not found in DB. Skipping stage.`,
          );
          return false;
        }

        const existingStages: DeploymentStages[] =
          (currentDeployment?.stages as unknown as DeploymentStages[]) || [];
        const currentTimeline: DeploymentTimeline[] =
          (currentDeployment?.timeline as unknown as DeploymentTimeline[]) ||
          [];

        const alreadyDone = existingStages.some(
          (existingStage) =>
            existingStage.name === stageName &&
            existingStage.status === DeploymentStageStatus.COMPLETED,
        );

        if (alreadyDone) {
          console.log(`${stageName} already completed. Skipping.`);
          return true;
        }

        const result = execute();
        const startedAt = new Date().toISOString();

        existingStages.push({
          name: stageName,
          status: DeploymentStageStatus.COMPLETED,
          startedAt,
          completedAt: new Date().toISOString(),
          message: result.summary,
          details: result.details,
        });

        currentTimeline.push({
          timestamp: new Date().toISOString(),
          event: stageName,
          message: result.summary,
        });

        const recorded = await prisma.deployment.updateMany({
          where: { id: deploymentId, status: DeploymentStatus.RUNNING },
          data: {
            stages: existingStages as any,
            timeline: currentTimeline as any,
          },
        });
        if (recorded.count !== 1) return false;

        await publishStageCompleted(
          deploymentId,
          stageName,
          resources.length,
          result.summary,
        );
        console.log(
          `${stageName} completed for deployment id: ${deploymentId}`,
        );
        return true;
      };

      // a. Validate — real graph traversal + type-presence rules. This gate can
      // bite: a design error fails the deployment fast with a causal message.
      // No throw — a design error is not a transient fault, so no BullMQ retries.
      const readiness = validateDeploymentReadiness(resources, connectionLines);
      if (!readiness.valid) {
        const failureReason = readiness.errors.join("; ");
        const failed = await prisma.deployment.updateMany({
          where: { id: deploymentId, status: DeploymentStatus.RUNNING },
          data: {
            status: DeploymentStatus.FAILED,
            timeline: [
              {
                timestamp: new Date().toISOString(),
                event: "Deployment Failed",
                message: failureReason,
              },
            ] as any,
          },
        });
        if (failed.count !== 1) return;
        await publishDeploymentFailed(deploymentId, failureReason);
        console.log(
          `Deployment ${deploymentId} FAILED at Validate — ${failureReason}`,
        );
        return;
      }

      const validatePassed = await runGate("Validate", () => ({
        status: "passed",
        summary: `${resources.length} resources, ${connectionLines.length} connections — structurally ready`,
        details: { warnings: readiness.warnings },
      }));
      if (!validatePassed) return;

      // b. SecurityScan — real rule checks (warn, don't block)
      const securityPassed = await runGate("SecurityScan", () =>
        runSecurityScan(resources),
      );
      if (!securityPassed) return;

      // c. CostEstimate — real SKU-driven pricing math
      const costPassed = await runGate("CostEstimate", () =>
        runCostEstimation(resources),
      );
      if (!costPassed) return;

      // Construct from the same immutable inputs before making the run LIVE.
      if (!(await startSimulation(deploymentId))) return;

      // broadcasts to Redis pub/sub. Websocket server will forward it to frontend.
      // Publish that current deployment is now live
      await publishDeploymentLive(deploymentId, resources.length);
      console.log(`Deployment is LIVE ${deploymentId}`);
    } catch (err: any) {
      const status = deploymentFailureStatus(job.attemptsMade, job.opts.attempts);
      const failure = await prisma.deployment.updateMany({
        where: {
          id: deploymentId,
          status: { in: [DeploymentStatus.PENDING, DeploymentStatus.RUNNING] },
        },
        data: {
          status,
        },
      });

      if (failure.count > 0 && status === DeploymentStatus.FAILED) {
        await publishDeploymentFailed(
          deploymentId,
          `Deployment failed at some stage due to: ${err.message}`,
        );
      }
      throw err; // This tells BullMQ that the deploymentJob failed due to worker crash or something it will retry on the basis of retries set in the queue.ts file...
    }
  },
  {
    connection: redis,
    stalledInterval: 30000, // How long to wait before marking stalled
    maxStalledCount: 10, // How many times a job can stall before failing
  },
);
