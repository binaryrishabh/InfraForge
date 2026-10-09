import { prisma } from "../lib/prisma";
import { redis } from "../infra/redis";
import { publishSimulationSnapshot } from "../infra/pubsub";
import {
  createInitialState,
  tick,
  buildPoolSnapshots,
  applyManualScale,
  reconcileTopology,
} from "@shared/simulation/engine";
import { computeHourlyBurnRateUsd } from "@shared/simulation/cost";
import { engineSeed, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import type { WorkerOwnership } from "../infra/workerOwnership";
import type { RunTopology } from "@shared/interface/RunInputs.interface";
import { SIMULATION_CONSTANTS } from "@shared/constants/SIMULATION_CONSTANTS.constants";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import type { SimulationState } from "@shared/interface/SimulationState.interface";
import type { ChaosType } from "@infraforge/domain/resource";
import type { ChaosEffect } from "@shared/interface/ChaosEffect.interface";
import type { VerticalScaleAction } from "@shared/interface/VerticalScaleAction.interface";
import type { SimulationSnapshot } from "@shared/interface/SimulationSnapshot.interface";
import type { SimulationLog } from "@shared/interface/SimulationLog.interface";

interface SimulationInstance {
  state: SimulationState;
  tickCount: number;
  pendingLogs: SimulationLog[];
  speed: number;
  lastCheckpointAt: number;
  accumulatedCostUsd: number;
  topology: RunTopology;
  topologyRevision: number;
}

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
  if (!deployment || deployment.status !== DeploymentStatus.RUNNING) return false;
  const input = readRunInputs(deployment.runInputs);
  const state = createInitialState(
    deploymentId,
    input.resources,
    input.connectionLines,
    input.workloadProfile,
    engineSeed(input.seed),
  );
  const started = await prisma.deployment.updateMany({
    where: { id: deploymentId, status: DeploymentStatus.RUNNING, runtimeActive: false },
    data: { status: DeploymentStatus.LIVE, runtimeActive: true },
  });
  if (started.count !== 1) return false;
  const instance: SimulationInstance = {
    state,
    tickCount: 0,
    pendingLogs: [],
    speed: 1,
    lastCheckpointAt: Date.now(),
    accumulatedCostUsd: 0,
    topology: { resources: input.resources, connectionLines: input.connectionLines },
    topologyRevision: 0,
  };
  registry.set(deploymentId, instance);
  console.log(
    `[simulator] registered ${deploymentId} | ${input.resources.length} resources | target ${Math.round(state.targetRps)} rps`,
  );
  // Publish the original initialized state before any live topology/control
  // can be applied by the next serialized runtime cycle.
  await publishSimulationSnapshot(buildSnapshot(deploymentId, instance, []));
  return true;
}

function buildSnapshot(deploymentId: string, instance: SimulationInstance, logs: SimulationLog[]): SimulationSnapshot {
  const pools = buildPoolSnapshots(instance.state);
  return {
    deploymentId, timestamp: new Date().toISOString(),
    simulatedSeconds: instance.state.simulatedSeconds, loadFraction: instance.state.loadFraction,
    metrics: instance.state.metrics, logs, health: instance.state.overallHealth,
    pools: pools.pools, spawnedVms: pools.spawnedVms,
    restarting: instance.state.verticalScaling.map((v) => v.resourceId),
    activeChaos: instance.state.activeChaos, speed: instance.speed,
    burnRatePerHourUsd: computeHourlyBurnRateUsd(instance.state), accumulatedCostUsd: instance.accumulatedCostUsd,
    liveTopology: instance.topology, topologyRevision: instance.topologyRevision,
  };
}

export const stopSimulation = async (deploymentId: string) => {
  registry.delete(deploymentId);
  await prisma.deployment.updateMany({ where: { id: deploymentId }, data: { runtimeActive: false } });
};

/* ------- Control channel: load adjustments, stop commands, chaos injection, vertical scaling, manual pool scaling, speed control, and topology sync from the API server ------- */
const controlSubscriber = redis.duplicate();
controlSubscriber.on("message", (_channel: string, message: string) => {
  try {
    const command = JSON.parse(message) as {
      deploymentId: string;
      action: string;
      targetLoadFraction?: number;
      chaosType?: ChaosType;
      resourceId?: string;
      skuId?: string;
      lbId?: string;
      delta?: number;
      speed?: number;
    };
    const instance = registry.get(command.deploymentId);
    if (!instance) return;
    if (
      command.action === "set-load" &&
      typeof command.targetLoadFraction === "number"
    ) {
      const clamped = Math.min(2, Math.max(0, command.targetLoadFraction));
      instance.state.targetLoadFraction = clamped;
      const pct = Math.round(clamped * 100);
      instance.pendingLogs.push({
        timestamp: new Date().toISOString(),
        severity: clamped > 1 ? "warn" : "info",
        source: "load-tester",
        message:
          clamped > 1
            ? `load target raised to ${pct}% of declared capacity — exceeding design load`
            : `load target set to ${pct}% of declared capacity`,
      });
      console.log(
        `[simulator] load target for ${command.deploymentId} set to ${pct}%`,
      );
    } else if (command.action === "stop") {
      void stopSimulation(command.deploymentId).catch(() => console.error("Could not acknowledge simulator stop; runtime polling will retry."));
      console.log(
        `[simulator] stopped ${command.deploymentId} — environment torn down`,
      );
    } else if (
      command.action === "inject-chaos" &&
      command.chaosType &&
      command.resourceId
    ) {
      const durationMap: Record<ChaosType, number> = {
        crash: SIMULATION_CONSTANTS.CHAOS.CRASH_DURATION,
        "cpu-spike": SIMULATION_CONSTANTS.CHAOS.CPU_SPIKE_DURATION,
        "memory-leak": SIMULATION_CONSTANTS.CHAOS.MEMORY_LEAK_DURATION,
        "network-delay": SIMULATION_CONSTANTS.CHAOS.NETWORK_DELAY_DURATION,
        "disk-failure": SIMULATION_CONSTANTS.CHAOS.DISK_FAILURE_DURATION,
      };
      const durationTicks = durationMap[command.chaosType];
      if (durationTicks === undefined) {
        console.error(`[simulator] unknown chaos type: ${command.chaosType}`);
        return;
      }
      const effect: ChaosEffect = {
        chaosType: command.chaosType,
        resourceId: command.resourceId,
        durationTicks,
        remainingTicks: durationTicks,
      };
      instance.state.activeChaos.push(effect);
      console.log(
        `[simulator] chaos ${command.chaosType} injected on ${command.resourceId} for ${command.deploymentId}`,
      );
    } else if (
      command.action === "scale-vertical" &&
      command.resourceId &&
      command.skuId
    ) {
      const action: VerticalScaleAction = {
        resourceId: command.resourceId,
        toSkuId: command.skuId,
        downtimeTicks: SIMULATION_CONSTANTS.VERTICAL_SCALING.RESTART_TICKS,
        remainingTicks: SIMULATION_CONSTANTS.VERTICAL_SCALING.RESTART_TICKS,
      };
      instance.state.verticalScaling.push(action);
      console.log(
        `[simulator] vertical scale ${command.resourceId} -> ${command.skuId} for ${command.deploymentId}`,
      );
    } else if (
      command.action === "scale-pool" &&
      command.lbId &&
      (command.delta === 1 || command.delta === -1)
    ) {
      const result = applyManualScale(
        instance.state,
        command.lbId,
        command.delta as 1 | -1,
      );
      instance.state = result.state;
      instance.pendingLogs.push(result.log);
      console.log(
        `[simulator] manual scale ${command.delta === 1 ? "up" : "down"} on ${command.lbId} for ${command.deploymentId}`,
      );
    } else if (
      command.action === "set-speed" &&
      typeof command.speed === "number"
    ) {
      const validSpeeds = [0, 1, 10, 60];
      if (validSpeeds.includes(command.speed)) {
        instance.speed = command.speed;
        console.log(
          `[simulator] speed for ${command.deploymentId} set to ${command.speed}x`,
        );
      } else {
        console.error(
          `[simulator] invalid speed ${command.speed} for ${command.deploymentId} — must be 0, 1, 10, or 60`,
        );
      }
    }
  } catch (err: any) {
    console.error(`[simulator] control message failed: ${err.message}`);
  }
});

let runtimeTimer: ReturnType<typeof setTimeout> | undefined;
let runtimeStopped = true;

export async function startRuntime(ownership: WorkerOwnership) {
  await controlSubscriber.subscribe("simulator:control");
  runtimeStopped = false;
  const cycle = async () => {
    try {
      await ownership.assertHeld();
      if (!runtimeStopped) {
        await advanceSimulations();
        // Retry acknowledgements even if an earlier stop notification's DB
        // write failed after its in-memory instance had already been removed.
        await prisma.deployment.updateMany({
          where: { runtimeActive: true, status: { in: ["torn-down", "failed", "completed"] } },
          data: { runtimeActive: false },
        });
      }
    } catch (error) { console.error("Simulator cycle failed", error); }
    finally { if (!runtimeStopped) runtimeTimer = setTimeout(cycle, 1000); }
  };
  runtimeTimer = setTimeout(cycle, 1000);
}

export function stopRuntime() {
  runtimeStopped = true;
  clearTimeout(runtimeTimer);
  registry.clear();
}

async function advanceSimulations() {
  for (const [deploymentId, instance] of registry) {
    try {
      const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
      if (registry.get(deploymentId) !== instance) continue;
      if (!deployment || deployment.status !== DeploymentStatus.LIVE || !deployment.runtimeActive) {
        await stopSimulation(deploymentId);
        continue;
      }
      if (deployment.topologyRevision > instance.topologyRevision) {
        const topology = LayoutSchema.parse(deployment.liveTopology);
        instance.state = reconcileTopology(instance.state, topology.resources, topology.connectionLines);
        instance.topology = { resources: topology.resources, connectionLines: topology.connectionLines };
        instance.topologyRevision = deployment.topologyRevision;
        instance.pendingLogs.push({ timestamp: new Date().toISOString(), severity: "info", source: "simulator",
          message: `topology revision ${instance.topologyRevision} applied — ${topology.resources.length} resources` });
      }
      const speed = instance.speed;
      // Paused — skip entirely. No ticks, no snapshot, no checkpoint, no cost.
      if (speed === 0) {
        continue;
      }
      // Run `speed` engine ticks per real second, accumulating logs.
      const allLogs: SimulationLog[] = [];
      for (let i = 0; i < speed; i++) {
        const result = tick(instance.state, {});
        instance.state = result.state;
        instance.tickCount += 1;
        allLogs.push(...result.logs);
        // Live cost: one simulated second = 1/3600 of an hour. Accumulated per
        // tick so burn-rate changes from autoscaling / vertical scaling are
        // tracked mid-interval. Cost is a pure function of SIMULATED time —
        // never speed-multiplied (Locked Decision #8).
        instance.accumulatedCostUsd +=
          computeHourlyBurnRateUsd(instance.state) / 3600;
      }
      // Build ONE snapshot per interval from the final state (instance.state
      // is the last tick's result.state), draining any queued control logs.
      const queuedLogs = instance.pendingLogs.splice(0);
      const snapshot = buildSnapshot(deploymentId, instance, [...queuedLogs, ...allLogs]);
      if (runtimeStopped || registry.get(deploymentId) !== instance) continue;
      await publishSimulationSnapshot(snapshot);
      // Neon relief: wall-time-based checkpoint (at most once per real minute),
      // persisting only non-derivable runtime state. This keeps 60x speed from
      // writing to Postgres every second.
      if (Date.now() - instance.lastCheckpointAt >= 60000) {
        instance.lastCheckpointAt = Date.now();
        const s = instance.state;
        const checkpoint = {
          simulatedSeconds: s.simulatedSeconds,
          loadFraction: s.loadFraction,
          targetLoadFraction: s.targetLoadFraction,
          overallHealth: s.overallHealth,
          metrics: s.metrics,
          activeChaos: s.activeChaos,
          pools: s.pools,
          spawnedVms: s.spawnedVms,
          verticalScaling: s.verticalScaling,
          accumulatedCostUsd: instance.accumulatedCostUsd,
        };
        await prisma.deployment.updateMany({
          where: { id: deploymentId, status: DeploymentStatus.LIVE, runtimeActive: true },
          data: { simulationState: checkpoint as any },
        });
      }
    } catch (err: any) {
      console.error(
        `[simulator] tick failed for ${deploymentId}: ${err.message}`,
      );
    }
  }
}
