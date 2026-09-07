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
  resurrectLiveDeployments,
} from "./simulator/simulator";
import { runSecurityScan } from "./stages/securityScan.stages";
import { runCostEstimation } from "./stages/costEstimation.stages";
import { OutboxBullMQStatus } from "@shared/enum/OutboxBullMQStatus.enum";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import { DeploymentStageStatus } from "@shared/enum/DeploymentStageStatus.enum";
import { validateDeploymentReadiness } from "@shared/validation/validateDeploymentReadiness.validation";
import type { OutboxPayload } from "@shared/interface/OutboxPayload.interface";
import type { DeploymentJob } from "@shared/interface/DeploymentJob.interface";
import type { DeploymentStages } from "@shared/interface/DeploymentStages.interface";
import type { DeploymentTimeline } from "@shared/interface/DeploymentTimeline.interface";

// Outbox processor-> Polls the unprocessed events from outbox table every 5 seconds and adds to BullMQ.
// This is because we have implemented the atomicity in the /api/deployments api end-point code.
// This is polling to the database server every 5 seconds. But at production shift to switch to CDC with Debezium and Kafka.

// Wait 5s for Redis connection to establish before polling outbox
await new Promise((r) => setTimeout(r, 5000));

resurrectLiveDeployments().catch((err) =>
  console.error("Resurrection failed: " + err.message),
);

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
            await prisma.deployment.update({
              where: {
                id: (entry.payload as unknown as OutboxPayload).deploymentId,
              },
              data: { status: DeploymentStatus.FAILED },
            });
            await publishOutboxFailed(
              (entry.payload as unknown as OutboxPayload).deploymentId,
              "Outbox delivery exhausted all retries.",
            );
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
    const {
      deploymentId,
      resources,
      connectionLines = [],
    } = job.data as DeploymentJob;

    try {
      // 1. Mark deployment as running
      const deploymentState = await prisma.deployment.findUnique({
        where: {
          id: deploymentId,
        },
        select: { status: true },
      });

      if (!deploymentState) {
        // If deployment with specified deploymentId doesn't exists
        console.error(
          `Deployment ${deploymentId} not found in DB. Skipping stage.`,
        );
        return;
      }

      if (deploymentState.status === DeploymentStatus.COMPLETED) {
        console.log(`Deployment ${deploymentId} already completed. Skipping.`);
        return;
      }

      if (deploymentState.status === DeploymentStatus.FAILED) {
        console.log(`Deployment ${deploymentId} already failed. Skipping.`);
        return;
      }

      if (deploymentState.status !== DeploymentStatus.RUNNING) {
        await prisma.deployment.update({
          where: {
            id: deploymentId,
          },
          data: {
            status: DeploymentStatus.RUNNING,
          },
        });
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

        await prisma.deployment.update({
          where: { id: deploymentId },
          data: {
            stages: existingStages as any,
            timeline: currentTimeline as any,
          },
        });

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
        await prisma.deployment.update({
          where: { id: deploymentId },
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

      // 3. Mark as LIVE
      // Update the status in the db as live for this deployment
      await prisma.deployment.update({
        where: {
          id: deploymentId,
        },
        data: {
          status: DeploymentStatus.LIVE,
        },
      });

      // broadcasts to Redis pub/sub. Websocket server will forward it to frontend.
      // Publish that current deployment is now live
      await publishDeploymentLive(deploymentId, resources.length);
      console.log(`Deployment is LIVE ${deploymentId}`);
      await startSimulation(deploymentId);
    } catch (err: any) {
      await prisma.deployment.update({
        where: {
          id: deploymentId,
        },
        data: {
          status: DeploymentStatus.FAILED,
        },
      });

      // Publish that current deployment failed....
      await publishDeploymentFailed(
        deploymentId,
        `Deployment failed at some stage due to: ${err.message}`,
      );
      throw err; // This tells BullMQ that the deploymentJob failed due to worker crash or something it will retry on the basis of retries set in the queue.ts file...
    }
  },
  {
    connection: redis,
    stalledInterval: 30000, // How long to wait before marking stalled
    maxStalledCount: 10, // How many times a job can stall before failing
  },
);