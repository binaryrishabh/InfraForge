import { Worker } from "bullmq";
import { redis } from "./infra/redis";
import { prisma } from "./lib/prisma";
import { deploymentQueue } from "./infra/queue";
import { publishChaosInjected, publishDeploymentLive, publishDeploymentFailed, publishDeploymentStarted, publishOutboxFailed, publishStageCompleted } from "./infra/pubsub";
import { startSimulation, resurrectLiveDeployments } from "./simulator/simulator";
import { runSecurityScan } from "./stages/securityScan.stages"
import { runCostEstimation } from "./stages/costEstimation.stages"
import { OutboxBullMQStatus } from "@shared/enum/OutboxBullMQStatus.enum";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import { DEPLOYMENT_STAGES_NAMES } from "@shared/constants/DEPLOYMENT_STAGES_NAMES.constants";
import { DeploymentStageStatus } from "@shared/enum/DeploymentStageStatus.enum";
import type { OutboxPayload } from "@shared/interface/OutboxPayload.interface";
import type { DeploymentJob } from "@shared/interface/DeploymentJob.interface";
import type { DeploymentStages } from "@shared/interface/DeploymentStages.interface";
import type { DeploymentTimeline } from "@shared/interface/DeploymentTimeline.interface";

// Outbox processor-> Polls the unprocessed events from outbox table every 5 seconds and adds to BullMQ.
// This is because we have implemented the atomicity in the /api/deployments api end-point code.
// This is polling to the database server every 5 seconds. But at production shift to switch to CDC with Debezium and Kafka.

// Wait 5s for Redis connection to establish before polling outbox
await new Promise(r => setTimeout(r, 5000));

resurrectLiveDeployments().catch(err => console.error("Resurrection failed: " + err.message));

/*
What setInterval is doing:- OUTBOX PROCESSOR

Polls the outbox table every 5 seconds. Processes pending entries.
Two delivery paths:

1. "deployment-created"  →  BullMQ queue  →  Worker processes 7 stages
2. "chaos-injected"      →  Redis Pub/Sub  →  WebSocket clients directly

Why: Chaos events don't need BullMQ processing. They just need real-time
notification. Skipping BullMQ reduces latency and keeps the queue clean.

Later Production upgrade path: Replace polling with CDC (Debezium + Kafka).
*/
async function pollOutbox() {
    try {
        // 1. FETCH — Get up to 10 unprocessed entries, ordered by fewest retries first
        const unprocessed = await prisma.outbox.findMany({
            where: {
                status: OutboxBullMQStatus.PENDING,
            },
            orderBy: [
                { retries: "asc" },    // Entries with fewest retries get priority
                { createdAt: "asc" }   // Older entries first
            ],
            take: 10
        });

        // 2. PROCESS — Handle each entry
        for (const entry of unprocessed) {
            try {
                // a. Publish based on event type i.e. it's a chaos or deployment?
                if (entry.eventType === "chaos-injected") {
                    // Chaos injected events, publish directly to Redis Pub/Sub.
                    // No BullMQ needed just real-time notification that a chaos has been injected.
                    await publishChaosInjected(entry as unknown as { payload: OutboxPayload });
                } else {
                    // Add Deployment to BullMQ queue for worker to process it.
                    // jobId = deploymentId ensures idempotency, duplicates are ignored by BullMQ automatically, ensures processing only once at max.
                    await deploymentQueue.add(entry.eventType, entry.payload, {
                        jobId: (entry.payload as unknown as OutboxPayload).deploymentId
                    });
                }

                // b. Mark as completed adding to queue for deployment and publishing to redis pub/sub for chaos injection succeeded
                await prisma.outbox.update({
                    where: { id: entry.id },
                    data: {
                        status: OutboxBullMQStatus.COMPLETED,
                        processedAt: new Date()
                    }
                });
            } catch (err: any) {
                // c. Adding to queue or publishing to publisher failed, retry or abandon it
                const newRetries = entry.retries + 1;
                const isFailed = newRetries >= entry.maxRetries;

                // Update retry count and status
                await prisma.outbox.update({
                    where: { id: entry.id },
                    data: {
                        status: isFailed ? OutboxBullMQStatus.FAILED : OutboxBullMQStatus.PENDING,
                        retries: newRetries,
                        error: err.message
                    }
                });

                // If permanently failed, mark deployment as failed and notify
                if (isFailed) {
                    try {
                        await prisma.deployment.update({
                            where: { id: (entry.payload as unknown as OutboxPayload).deploymentId },
                            data: { status: DeploymentStatus.FAILED }
                        });
                        await publishOutboxFailed(
                            (entry.payload as unknown as OutboxPayload).deploymentId,
                            "Outbox delivery exhausted all retries."
                        );
                    } catch (sideEffectErr: any) {
                        console.error(`Failure handling failed for outbox ${entry.id}: ${sideEffectErr.message}`);
                    }
                    console.error(
                        `Outbox ${entry.id} | deployment ${(entry.payload as unknown as OutboxPayload).deploymentId} | PERMANENTLY FAILED | ${err.message}`
                    );
                }
                else {
                    console.error(
                        `Outbox ${entry.id} | deployment ${(entry.payload as unknown as OutboxPayload).deploymentId} | Retry ${newRetries}/${entry.maxRetries} already done | ${err.message}`
                    );
                }
            }
        }
    } catch (err: any) {
        // Outer catch — errors here don't crash the poller. Next interval retries.
        console.error(`Outbox poller error: ${err.message}`);
    }
    finally {
        setTimeout(pollOutbox, 5000);
    }
}

pollOutbox();

const worker = new Worker (
    "deployments", // Watches the "deploymets" queue
    async (job) => { // This function runs for every job
        // The 7 stage will go here
        const { deploymentId, resources } = job.data as DeploymentJob;

        try {
            // 1. Mark deployment as running
            const deploymentState = await prisma.deployment.findUnique({
                where: {
                    id: deploymentId,
                }
            });

            if(!deploymentState) { // If deployment with specified deploymentId doesn't exists
                console.error(`Deployment ${deploymentId} not found in DB. Skipping stage.`);
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

            if(deploymentState.status !== DeploymentStatus.RUNNING) {
                await prisma.deployment.update({
                    where: {
                        id: deploymentId,
                    },
                    data: {
                        status: DeploymentStatus.RUNNING
                    }
                });
            }

            // Publish as current deployment has started running
            await publishDeploymentStarted(deploymentId, resources.length);
            console.log(`Deployment started ${deploymentId}`);

            // 2. Process each stage
            for(const stage of DEPLOYMENT_STAGES_NAMES) { // DEPLOYMENT_STAGES_NAMES This is from the global shared constants file
                // Read the deployment from DB for each stage so that we could prevent stale data if something else modified it.

                // 0. Ckeck if this stage is already completed(idempotency)
                const currentDeployment = await prisma.deployment.findUnique({
                    where: {
                        id: deploymentId
                    }
                });

                if(!currentDeployment) { // If deployment with specified deploymentId doesn't exists
                    console.error(`Deployment ${deploymentId} not found in DB. Skipping stage.`);
                    return;
                }

                // Fetch all the stage positions in the deployment.
                const existingStages: DeploymentStages[] = (currentDeployment?.stages as unknown as DeploymentStages[]) || [];
                const currentTimeline: DeploymentTimeline[] = (currentDeployment?.timeline as unknown as DeploymentTimeline[]) || [];

                // Find which all existing stages already completed so that u can skip...
                const alreadyDone = existingStages.some(existingStage => existingStage.name === stage && existingStage.status === DeploymentStageStatus.COMPLETED);

                // Skip if already done
                if(alreadyDone) {
                    console.log(`${stage} already completed. Skipping.`);
                    continue;
                }

                // Simulate work for security and cost estimation
                let stateMessage: string = "";
                let stageDetails: Record<string, any> = {};

                switch(stage) {
                    case "SecurityScan":
                        const securityResult = runSecurityScan(resources);
                        stateMessage = securityResult.summary;
                        stageDetails = securityResult.details;
                        break;
                    case "CostEstimate":
                        const costResult = runCostEstimation(resources);
                        stateMessage = costResult.summary;
                        stageDetails = costResult.details;
                        break;
                    default:
                        stateMessage = `${stage} completed for ${resources.length} resources`;
                }

                const startedAt = new Date().toISOString();
                
                // Provisioning time scales with infrastructure size — labelled tuning physics, not a magic delay
                const PROVISION_BASE_MS = 800;
                const PROVISION_PER_RESOURCE_MS = 150;
                const stageWorkMs = PROVISION_BASE_MS + resources.length * PROVISION_PER_RESOURCE_MS;
                await new Promise(waitHere => setTimeout(waitHere, stageWorkMs));

                // Add stage entry for current stage which will get updated to db finally
                existingStages.push({
                    name: stage,
                    status: DeploymentStageStatus.COMPLETED,
                    startedAt,
                    completedAt: new Date().toISOString(),
                    message: stateMessage,
                    details: stageDetails
                });

                // Add timeline entry for current stage which will get updated to db finally
                currentTimeline.push({
                    timestamp: new Date().toISOString(),
                    event: stage,
                    message: stateMessage
                });

                // Update DB
                // Keep updating stages and timeline in db for each stage
                await prisma.deployment.update({
                    where: {
                        id: deploymentId
                    },
                    data: {
                        stages: (existingStages as any),
                        timeline: (currentTimeline as any)
                    }
                });

                // Publish as current stage is completed.
                await publishStageCompleted(deploymentId, stage, resources.length, stateMessage);
                console.log(`${stage} completed for deployment id: ${deploymentId}`);
            }

            // 3. Mark as LIVE
            // Update the status in the db as live for this deployment
            await prisma.deployment.update({
                where: {
                    id: deploymentId
                },
                data: {
                    status: DeploymentStatus.LIVE
                }
            });

            // broadcasts to Redis pub/sub. Websocket server will forward it to frontend.
            // Publish that current deployment is now live
            await publishDeploymentLive( deploymentId, resources.length );
            console.log(`Deployment is LIVE ${deploymentId}`);
            await startSimulation(deploymentId);
        }
        catch (err: any) {
            await prisma.deployment.update({
                where: {
                    id: deploymentId
                },
                data: {
                    status: DeploymentStatus.FAILED
                }
            });

            // Publish that current deployment failed....
            await publishDeploymentFailed( deploymentId, `Deployment failed at some stage due to: ${err.message}`);
            throw err; // This tells BullMQ that the deploymentJob failed due to worker crash or something it will retry on the basis of retries set in the queue.ts file...
        }
    },
    {
        connection: redis,
        stalledInterval: 30000,  // How long to wait before marking stalled
        maxStalledCount: 10      // How many times a job can stall before failing
    }
)