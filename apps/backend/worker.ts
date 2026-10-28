import { claimDeployment } from "./deployments/admission";
import { operationalLimits } from "./deployments/operationalLimits";
import { Queue, Worker, DelayedError } from "bullmq";
import { redis, commandRedis } from "./infra/redis";
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
import { operationalWarning, outboxRetryDelay } from "./utils/connectionPolicy";
import http from "node:http";
import { workerDatabaseUrl, verifyWorkerSession } from "./infra/workerConnection";
import { assertRuntimeSchema } from "./release/runtime";
import { createReadiness } from "./health/readiness";
import { retireInterruptedRuns, QUARANTINED_RUN_MESSAGE } from "./deployments/restartPolicy";
import { readRunInputs, assertSimulationContext, runsOnModel2 } from "./deployments/runInputs";
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

await assertRuntimeSchema();
const databaseUrl = workerDatabaseUrl(process.env);
if (config.NODE_ENV === "production") await verifyWorkerSession(databaseUrl);
const ownership = await WorkerOwnership.acquire(databaseUrl, () => {
  stopRuntime();
  console.error("Worker ownership lost. Stopping before another worker can advance simulations.");
  process.exit(1);
});
await retireInterruptedRuns();
await startRuntime(ownership);
let stopping = false;
let outboxTimer: ReturnType<typeof setTimeout> | undefined;
let outboxPoll: Promise<void> | undefined;
let lastOutboxSuccess = 0;
let outboxFailures = 0;
const outboxWarning = operationalWarning("Outbox delivery unavailable; retrying with backoff.");

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
  if (stopping) return;
  let busy = false;
  let deliveryFailed = false;
  try {
    await ownership.assertHeld();
    // The durable creation deadline also bounds undelivered and gating work.
    // Live instances finish through the simulator's terminal capture transaction.
    await prisma.deployment.updateMany({ where: { status: { in: ["pending", "running"] }, runtimeActive: false,
      createdAt: { lte: new Date(Date.now() - operationalLimits.lifetimeSeconds * 1000) } },
      data: { status: "failed" } });
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
        } else if (entry.eventType === "model2-internal-created") {
          // Internal Model 2 runs were removed; an old event of this kind needs no delivery.
        } else {
          // Add Deployment to BullMQ queue for worker to process it.
          // jobId = deploymentId ensures idempotency, duplicates are ignored by BullMQ automatically, ensures processing only once at max.
          // A browser run's replay is a second job for the same run, so it needs its own job ID.
          const runId = (entry.payload as unknown as OutboxPayload).deploymentId;
          await deploymentQueue.add(entry.eventType, entry.payload, {
            jobId: entry.eventType === "deployment-replay" ? `${runId}-replay` : runId,
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
        deliveryFailed = true;
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
            error: "Outbox delivery failed",
          },
        });

        // If permanently failed, mark deployment as failed and notify
        if (isFailed) {
          try {
            if (entry.eventType === "deployment-created" || entry.eventType === "deployment-replay") {
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
          } catch {
            outboxWarning();
          }
          console.error(
            `Outbox ${entry.id} permanently failed after exhausting delivery retries.`,
          );
        } else {
          outboxWarning();
        }
      }
    }
    busy = unprocessed.length > 0;
    lastOutboxSuccess = Date.now();
  } catch {
    deliveryFailed = true;
    // Outer catch — errors here don't crash the poller. Next interval retries.
    outboxWarning();
  } finally {
    // Adaptive scheduling — Neon relief (Challenge C3): busy = fast re-poll
    // (1s) so queued work moves quickly; idle = back off (5s) so the
    // serverless DB can auto-suspend. The error path keeps the idle
    // interval so a transient failure never becomes a hot polling loop.
    outboxFailures = deliveryFailed ? outboxFailures + 1 : 0;
    const delay = deliveryFailed ? outboxRetryDelay(outboxFailures) : busy ? 1000 : 5000;
    if (!stopping) outboxTimer = setTimeout(() => { outboxPoll = pollOutbox(); }, delay);
  }
}

outboxPoll = pollOutbox();

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
        if (!deploymentState.ownerId) throw new Error(QUARANTINED_RUN_MESSAGE);
        inputs = readRunInputs(deploymentState.runInputs);
        assertSimulationContext(inputs);
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
        const claimed = await prisma.$transaction(tx => claimDeployment(tx, deploymentId));
        if (claimed === "busy") {
          // Capacity waits do not spend processing retries or release the queued reservation.
          await job.moveToDelayed(Date.now() + 5000, job.token);
          throw new DelayedError();
        }
        if (claimed !== "claimed") return;
      }

      // A submitted browser run passed its gates before the browser ran it; the worker only replays it.
      if (deploymentState.browserSubmission !== null) {
        if (await startSimulation(deploymentId)) console.log(`Replaying browser run ${deploymentId}`);
        return;
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

      // A Model 2 run executes in the browser. It waits here, costing the server nothing, until the browser submits.
      if (runsOnModel2(inputs)) {
        const waiting = await prisma.deployment.updateMany({ where: { id: deploymentId, status: DeploymentStatus.RUNNING },
          data: { status: DeploymentStatus.BROWSER } });
        if (waiting.count === 1) await publishDeploymentLive(deploymentId, resources.length);
        return;
      }

      // Construct from the same immutable inputs before making the run LIVE.
      if (!(await startSimulation(deploymentId))) return;

      // broadcasts to Redis pub/sub. Websocket server will forward it to frontend.
      // Publish that current deployment is now live
      await publishDeploymentLive(deploymentId, resources.length);
      console.log(`Deployment is LIVE ${deploymentId}`);
    } catch (err: any) {
      if (err instanceof DelayedError) throw err;
      const status = deploymentFailureStatus(job.attemptsMade, job.opts.attempts);
      // Transient errors retain the previous pending/running reservation. In
      // particular, an error before claim must never promote a queued job.
      const failure = status === DeploymentStatus.FAILED ? await prisma.deployment.updateMany({
        where: {
          id: deploymentId,
          status: { in: [DeploymentStatus.PENDING, DeploymentStatus.RUNNING] },
        },
        data: {
          status,
        },
      }) : { count: 0 };

      if (failure.count > 0 && status === DeploymentStatus.FAILED) {
        await publishDeploymentFailed(
          deploymentId,
          "Deployment failed after exhausting processing retries.",
        );
      }
      throw new Error("Deployment processing failed; retry according to the queue policy.");
    }
  },
  {
    connection: redis,
    stalledInterval: 30000, // How long to wait before marking stalled
    maxStalledCount: 10, // How many times a job can stall before failing
  },
);

worker.on("error", operationalWarning("Queue worker error; readiness will check its connection and processing loop."));
await worker.waitUntilReady();
const readiness = createReadiness(async () => {
  const backend = worker.getBackend();
  const [queueConnection, blockingConnection] = await Promise.all([backend.client, backend.blockingClient]);
  if (stopping || queueConnection.status !== "ready" || blockingConnection?.status !== "ready" ||
    !worker.isRunning() || Date.now() - lastOutboxSuccess > 15000) {
    throw new Error("Worker is not processing jobs/outbox");
  }
  await ownership.assertHeld();
});
await readiness.started;
const server = http.createServer(async (req, res) => {
  if (req.url === "/health/live") { res.writeHead(200); res.end("ok"); return; }
  if (req.url !== "/health/ready") { res.writeHead(404); res.end(); return; }
  const result = await readiness.check();
  res.writeHead(result.success ? 200 : 503, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
});
server.listen(Number(process.env.WORKER_HEALTH_PORT || 3002), config.LISTEN_HOST);

async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close();
  clearTimeout(outboxTimer);
  const runtimeStopped = stopRuntime();
  const deadline = setTimeout(() => process.exit(1), 25000);
  try {
    await worker.close();
    await deploymentQueue.close();
    await Promise.all([runtimeStopped, outboxPoll]);
    await readiness.close();
    await prisma.$disconnect();
    await ownership.close();
    clearTimeout(deadline);
    process.exit(0);
  } catch { process.exit(1); }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
