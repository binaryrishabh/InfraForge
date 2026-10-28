import { operationalLimits, runtimeHorizon, lifetimeExpired } from "../deployments/operationalLimits";
import { executionAllowance } from "../capabilities/policy";
import { prisma } from "../lib/prisma";
import { publishDeploymentFailed, publishSimulationSnapshot } from "../infra/pubsub";
import { createInitialState } from "@infraforge/simulation/engine";
import { engineSeed, readRunInputs, assertSimulationContext, runsOnModel2 } from "../deployments/runInputs";
import { ActionRefused, createModel2Engine } from "./model2Engine";
import { buildModel2Contract } from "./contractBuilder";
import { SubmissionSchema } from "../browserRuns/submission";
import { recordReplayActions } from "./replay";
import { closeAbandonedBrowserRuns } from "../browserRuns/abandon";
import type { WorkerOwnership } from "../infra/workerOwnership";
import { storedJson } from "../utils/json";
import type { SimulationInstance } from "./instance";
import { buildSnapshot, captureSnapshot } from "./snapshot";
import { processRunActions, recordActionCompletions } from "./actions";
import { flushAcknowledgement } from "./actionAcknowledgement";
import { advanceTickBatch, experimentDue, reachedMatchedStop, replayDue } from "./tickBatch";
import { finishMatchedStop } from "./matchedStop";
import { establishExperiment } from "./experiment";
import { readRecordedExperiment } from "../challenges/experiment";
import { createEvidenceBuffer } from "../evidence/capture";
import { flushEvidence } from "../evidence/persist";

// Simulated seconds per cycle for a replay; the 600 ms batch budget is the real limit.
const REPLAY_SPEED = 3600;
const registry = new Map<string, SimulationInstance>();
const initializing = new Map<string, Promise<boolean>>();

export function startSimulation(deploymentId: string): Promise<boolean> {
  if (registry.has(deploymentId)) return Promise.resolve(true);
  const pending = initializing.get(deploymentId);
  if (pending) return pending;
  if (registry.size + initializing.size >= operationalLimits.active) return Promise.reject(new Error("Simulator active capacity exceeded"));
  const initialization = initialize(deploymentId).finally(() => initializing.delete(deploymentId));
  initializing.set(deploymentId, initialization);
  return initialization;
}

async function initialize(deploymentId: string) {
  if (registry.has(deploymentId)) return true;
  const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment || deployment.status !== "running" || !deployment.ownerId) return false;
  if (registry.size >= operationalLimits.active) throw new Error("Simulator active capacity exceeded");
  const input = readRunInputs(deployment.runInputs);
  assertSimulationContext(input);
  const allowance = executionAllowance(deployment.autoStopAtSimulatedSeconds ?? deployment.evaluationStopAtSimulatedSeconds);
  const horizon = runtimeHorizon(allowance.durationSeconds);
  let engine: Pick<SimulationInstance, "state" | "model2">;
  if (runsOnModel2(input)) {
    // A design Model 2 cannot run fails now with its reason; it is not retried.
    try { engine = { model2: createModel2Engine(input, horizon, buildModel2Contract) }; }
    catch (error) {
      if (!(error instanceof ActionRefused)) throw error;
      const failed = await prisma.deployment.updateMany({ where: { id: deploymentId, status: "running", runtimeActive: false },
        data: { status: "failed", timeline: [...(Array.isArray(deployment.timeline) ? deployment.timeline : []),
          { timestamp: new Date().toISOString(), event: "Deployment Failed", message: error.message }] } });
      if (failed.count === 1) await publishDeploymentFailed(deploymentId, error.message);
      return false;
    }
  } else engine = { state: createInitialState(deploymentId, input.resources, input.connectionLines, input.workloadProfile, engineSeed(input.seed)) };
  // A recorded plan that cannot be read is never guessed at: the fault is not scheduled and the attempt is not judged.
  const plan = deployment.challengeExperiment == null ? null : readRecordedExperiment(deployment.challengeExperiment);
  // A browser run's replay runs at full speed (within the batch budget) to the second the browser stopped at.
  const submission = engine.model2 && deployment.browserSubmission != null ? SubmissionSchema.parse(deployment.browserSubmission) : null;
  const started = await prisma.deployment.updateMany({ where: { id: deploymentId, status: "running", runtimeActive: false },
    data: { status: "live", runtimeActive: true } });
  if (started.count !== 1) return false;
  const instance: SimulationInstance = { ...engine, tickCount: 0, pendingLogs: [], speed: submission ? REPLAY_SPEED : 1,
    lastCheckpointAt: Date.now(), accumulatedCostUsd: 0,
    topology: { resources: input.resources, connectionLines: input.connectionLines }, topologyRevision: 0,
    actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0,
    autoStopAtSimulatedSeconds: submission ? submission.stopAtSecond : horizon,
    stopTrigger: submission ? (submission.stopAtSecond === deployment.evaluationStopAtSimulatedSeconds ? "challenge-evaluation" : "matched-stop")
      : allowance.durationSeconds === null || allowance.durationSeconds > operationalLimits.runtimeSeconds
      ? "operational-limit" : deployment.evaluationStopAtSimulatedSeconds != null ? "challenge-evaluation" : "matched-stop", finishMatchedStop: null,
    replay: submission ? { actions: submission.actions, next: 0 } : null,
    experiment: plan ? { plan, phase: "scheduled" } : null,
    evidence: deployment.challengeId ? createEvidenceBuffer(plan, deployment.evaluationStopAtSimulatedSeconds) : null };
  registry.set(deploymentId, instance);
  await publishSimulationSnapshot(buildSnapshot(deploymentId, instance));
  return true;
}

export async function stopSimulation(deploymentId: string) {
  registry.delete(deploymentId);
  await prisma.deployment.updateMany({ where: { id: deploymentId }, data: { runtimeActive: false } });
}

let runtimeTimer: ReturnType<typeof setTimeout> | undefined;
let runtimeCycle: Promise<void> | undefined;
let runtimeStopped = true;
let lastAbandonSweep = 0;

export async function startRuntime(ownership: WorkerOwnership) {
  runtimeStopped = false;
  const cycle = async () => {
    try {
      await ownership.assertHeld();
      if (!runtimeStopped) await advanceSimulations();
      if (!runtimeStopped && Date.now() - lastAbandonSweep >= 60000) { lastAbandonSweep = Date.now(); await closeAbandonedBrowserRuns(); }
    } catch (error) { console.error("Simulator cycle failed", error); }
    finally { if (!runtimeStopped) runtimeTimer = setTimeout(() => { runtimeCycle = cycle(); }, 1000); }
  };
  runtimeTimer = setTimeout(() => { runtimeCycle = cycle(); }, 1000);
}

export function stopRuntime() {
  runtimeStopped = true;
  clearTimeout(runtimeTimer);
  registry.clear();
  return runtimeCycle ?? Promise.resolve();
}

async function advanceSimulations() {
  for (const [deploymentId, instance] of registry) {
    try {
      // A failed acknowledgement freezes this exact state, including terminal captures.
      await flushEvidence(deploymentId, instance);
      await flushAcknowledgement(instance);
      if (runtimeStopped || registry.get(deploymentId) !== instance) continue;
      const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
      if (!deployment || deployment.status !== "live" || !deployment.runtimeActive) {
        await stopSimulation(deploymentId);
        continue;
      }
      if (lifetimeExpired(deployment.createdAt)) {
        // Includes time queued and paused, survives restarts, and ignores user activity.
        // Finish through the existing evidence transaction before capacity is released.
        instance.stopTrigger = "operational-limit";
        await recordActionCompletions(instance);
        await finishMatchedStop(deploymentId, instance, () => registry.delete(deploymentId));
        continue;
      }
      if (reachedMatchedStop(instance)) {
        await recordActionCompletions(instance);
        await finishMatchedStop(deploymentId, instance, () => registry.delete(deploymentId));
        continue;
      }
      // Due experiment first: completions at this second were recorded by the tick that reached it,
      // then the fault is written and applied here, before any further tick.
      if (experimentDue(instance)) await establishExperiment(deploymentId, instance);
      if (replayDue(instance)) await recordReplayActions(deploymentId, instance);
      const terminal = await processRunActions(deploymentId, instance, () => registry.delete(deploymentId));
      if (terminal) {
        continue;
      }
      if (runtimeStopped || registry.get(deploymentId) !== instance) continue;
      // Poll actions before considering speed. Pause never prevents resume or teardown.
      if (await advanceTickBatch(instance, recordActionCompletions, () => runtimeStopped, (run) => flushEvidence(deploymentId, run))) {
        await finishMatchedStop(deploymentId, instance, () => registry.delete(deploymentId));
        continue;
      }
      // A batch that stopped at the experiment's second, or at a submitted action's, applies it in this same cycle.
      if (experimentDue(instance) || replayDue(instance)) {
        if (experimentDue(instance)) await establishExperiment(deploymentId, instance);
        if (replayDue(instance)) await recordReplayActions(deploymentId, instance);
        if (await processRunActions(deploymentId, instance, () => registry.delete(deploymentId))) continue;
      }
      if (runtimeStopped || registry.get(deploymentId) !== instance) continue;
      const snapshot = buildSnapshot(deploymentId, instance, instance.pendingLogs.splice(0));
      // Notifications are optional; actions and evidence are already durable.
      await publishSimulationSnapshot(snapshot).catch(() => {});
      if (instance.speed > 0 && Date.now() - instance.lastCheckpointAt >= 60000) {
        const checkpoint = captureSnapshot(deploymentId, instance, "checkpoint");
        const saved = await prisma.deployment.updateMany({ where: { id: deploymentId, status: "live", runtimeActive: true },
          data: { simulationState: storedJson(checkpoint) } });
        if (saved.count === 1) instance.lastCheckpointAt = Date.now();
      }
    } catch (error) { console.error(`Simulator evidence cycle failed for ${deploymentId}`, error); }
  }
}
