import { prisma } from "../lib/prisma";
import { publishSimulationSnapshot } from "../infra/pubsub";
import { createInitialState } from "@infraforge/simulation/engine";
import { engineSeed, readRunInputs, assertSimulationContext } from "../deployments/runInputs";
import type { WorkerOwnership } from "../infra/workerOwnership";
import { storedJson } from "../utils/json";
import type { SimulationInstance } from "./instance";
import { buildSnapshot, captureSnapshot } from "./snapshot";
import { processRunActions, recordActionCompletions } from "./actions";
import { flushAcknowledgement } from "./actionAcknowledgement";
import { advanceTickBatch, experimentDue, reachedMatchedStop } from "./tickBatch";
import { finishMatchedStop } from "./matchedStop";
import { establishExperiment } from "./experiment";
import { readRecordedExperiment } from "../challenges/experiment";
import { createEvidenceBuffer } from "../evidence/capture";
import { flushEvidence } from "../evidence/persist";

const registry = new Map<string, SimulationInstance>();
const initializing = new Map<string, Promise<boolean>>();

export function startSimulation(deploymentId: string): Promise<boolean> {
  const pending = initializing.get(deploymentId);
  if (pending) return pending;
  const initialization = initialize(deploymentId).finally(() => initializing.delete(deploymentId));
  initializing.set(deploymentId, initialization);
  return initialization;
}

async function initialize(deploymentId: string) {
  if (registry.has(deploymentId)) return true;
  const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment || deployment.status !== "running" || !deployment.ownerId) return false;
  const input = readRunInputs(deployment.runInputs);
  assertSimulationContext(input);
  const state = createInitialState(deploymentId, input.resources, input.connectionLines, input.workloadProfile, engineSeed(input.seed));
  // A recorded plan that cannot be read is never guessed at: the fault is not scheduled and the attempt is not judged.
  const plan = deployment.challengeExperiment == null ? null : readRecordedExperiment(deployment.challengeExperiment);
  const started = await prisma.deployment.updateMany({ where: { id: deploymentId, status: "running", runtimeActive: false },
    data: { status: "live", runtimeActive: true } });
  if (started.count !== 1) return false;
  const instance: SimulationInstance = { state, tickCount: 0, pendingLogs: [], speed: 1,
    lastCheckpointAt: Date.now(), accumulatedCostUsd: 0,
    topology: { resources: input.resources, connectionLines: input.connectionLines }, topologyRevision: 0,
    actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0,
    autoStopAtSimulatedSeconds: deployment.autoStopAtSimulatedSeconds ?? deployment.evaluationStopAtSimulatedSeconds,
    stopTrigger: deployment.evaluationStopAtSimulatedSeconds != null ? "challenge-evaluation" : "matched-stop", finishMatchedStop: null,
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

export async function startRuntime(ownership: WorkerOwnership) {
  runtimeStopped = false;
  const cycle = async () => {
    try {
      await ownership.assertHeld();
      if (!runtimeStopped) await advanceSimulations();
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
      if (reachedMatchedStop(instance)) {
        await recordActionCompletions(instance);
        await finishMatchedStop(deploymentId, instance, () => registry.delete(deploymentId));
        continue;
      }
      // Due experiment first: completions at this second were recorded by the tick that reached it,
      // then the fault is written and applied here, before any further tick.
      if (experimentDue(instance)) await establishExperiment(deploymentId, instance);
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
      // A batch that stopped at the experiment's second applies it in this same cycle.
      if (experimentDue(instance)) {
        await establishExperiment(deploymentId, instance);
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
