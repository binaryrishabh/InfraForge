import { prisma } from "../lib/prisma";
import { publishSimulationSnapshot } from "../infra/pubsub";
import { Publish } from "@infraforge/contracts/events";
import { redis } from "../infra/redis";
import { createInitialState, tick } from "@infraforge/simulation/engine";
import { computeHourlyBurnRateUsd } from "@infraforge/simulation/cost";
import { engineSeed, readRunInputs, assertSimulationContext } from "../deployments/runInputs";
import type { WorkerOwnership } from "../infra/workerOwnership";
import type { SimulationLog } from "@infraforge/contracts/telemetry";
import { storedJson } from "../utils/json";
import type { SimulationInstance } from "./instance";
import { buildSnapshot, captureSnapshot } from "./snapshot";
import { processRunActions, recordActionCompletions } from "./actions";
import { flushAcknowledgement } from "./actionAcknowledgement";
import { displaySimulationLogs } from "./logs";

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
  const started = await prisma.deployment.updateMany({ where: { id: deploymentId, status: "running", runtimeActive: false },
    data: { status: "live", runtimeActive: true } });
  if (started.count !== 1) return false;
  const instance: SimulationInstance = { state, tickCount: 0, pendingLogs: [], speed: 1,
    lastCheckpointAt: Date.now(), accumulatedCostUsd: 0,
    topology: { resources: input.resources, connectionLines: input.connectionLines }, topologyRevision: 0,
    actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0 };
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
      await flushAcknowledgement(instance);
      if (runtimeStopped || registry.get(deploymentId) !== instance) continue;
      const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
      if (!deployment || deployment.status !== "live" || !deployment.runtimeActive) {
        await stopSimulation(deploymentId);
        continue;
      }
      const terminal = await processRunActions(deploymentId, instance, () => registry.delete(deploymentId));
      if (terminal) {
        await publishSimulationSnapshot(terminal).catch(() => {});
        await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({ deploymentId,
          publishType: Publish.publishDeploymentTornDown, status: "torn-down", timestamp: terminal.capturedAt,
          message: "Simulation stopped; exact terminal state captured." })).catch(() => {});
        continue;
      }
      if (runtimeStopped || registry.get(deploymentId) !== instance) continue;
      const allLogs: SimulationLog[] = [];
      // Poll actions before considering speed. Pause never prevents resume or teardown.
      for (let i = 0; i < instance.speed && !runtimeStopped; i++) {
        const result = tick(instance.state, {});
        instance.state = result.state;
        instance.metricsComputedAt = new Date().toISOString();
        instance.metricsTopologyRevision = instance.topologyRevision;
        instance.tickCount += 1;
        allLogs.push(...displaySimulationLogs(result.logs));
        instance.accumulatedCostUsd += computeHourlyBurnRateUsd(instance.state) / 3600;
        // Observe each simulated second, even when one wall interval advances sixty ticks.
        await recordActionCompletions(instance);
      }
      if (runtimeStopped || registry.get(deploymentId) !== instance) continue;
      const snapshot = buildSnapshot(deploymentId, instance, [...instance.pendingLogs.splice(0), ...allLogs]);
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
