import { prisma } from "../lib/prisma";
import { redis } from "../infra/redis";
import { publishSimulationSnapshot } from "../infra/pubsub";
import { createInitialState, tick, buildPoolSnapshots, applyManualScale } from "@shared/simulation/engine";
import { computeHourlyBurnRateUsd } from "@shared/simulation/cost";
import { DEFAULT_WORKLOAD_PROFILE } from "@shared/constants/DEFAULT_WORKLOAD_PROFILE.constants";
import { SIMULATION_CONSTANTS } from "@shared/constants/SIMULATION_CONSTANTS.constants";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import type { SimulationState } from "@shared/interface/SimulationState.interface";
import type { ChaosType } from "@shared/types/ChaosType.types";
import type { ChaosEffect } from "@shared/interface/ChaosEffect.interface";
import type { VerticalScaleAction } from "@shared/interface/VerticalScaleAction.interface";
import type { SimulationSnapshot } from "@shared/interface/SimulationSnapshot.interface";
import type { SimulationLog } from "@shared/interface/SimulationLog.interface";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { WorkloadProfile } from "@shared/interface/WorkloadProfile.interface";

interface SimulationInstance {
  state: SimulationState;
  tickCount: number;
  pendingLogs: SimulationLog[];
  speed: number;
  lastCheckpointAt: number;
  accumulatedCostUsd: number;
}

const registry = new Map<string, SimulationInstance>();

const hashSeed = (seedText: string): number => {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = (Math.imul(31, hash) + seedText.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

export const startSimulation = async (deploymentId: string, existingDeployment?: { id: string; seed: string | null; workloadProfile: unknown; infrastructureId: string } | null) => {
  if (registry.has(deploymentId)) return;
  const deployment = existingDeployment ?? await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) {
    console.error(`[simulator] deployment ${deploymentId} not found`);
    return;
  }
  const infrastructure = await prisma.infrastructure.findUnique({ where: { id: deployment.infrastructureId } });
  const layout = (infrastructure?.layout ?? {}) as { resources?: Resource[]; connectionLines?: ConnectionLine[] };
  const resources = layout.resources ?? [];
  const connectionLines = layout.connectionLines ?? [];
  let seedText = deployment.seed;
  if (!seedText) {
    seedText = Math.random().toString(36).slice(2, 10);
    await prisma.deployment.update({ where: { id: deploymentId }, data: { seed: seedText } });
  }
  const workloadProfile = (deployment.workloadProfile as WorkloadProfile | null) ?? DEFAULT_WORKLOAD_PROFILE;
  const state = createInitialState(deploymentId, resources, connectionLines, workloadProfile, hashSeed(seedText));
  registry.set(deploymentId, { state, tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: Date.now(), accumulatedCostUsd: 0 });
  console.log(`[simulator] registered ${deploymentId} | ${resources.length} resources | target ${Math.round(state.targetRps)} rps`);
};

export const stopSimulation = (deploymentId: string) => {
  registry.delete(deploymentId);
};

export const resurrectLiveDeployments = async () => {
  const liveDeployments = await prisma.deployment.findMany({ where: { status: DeploymentStatus.LIVE } });
  for (const deployment of liveDeployments) {
    await startSimulation(deployment.id, deployment);
  }
  if (liveDeployments.length > 0) {
    console.log(`[simulator] resurrected ${liveDeployments.length} live deployment(s)`);
  }
};

/* ------- Control channel: load adjustments, stop commands, chaos injection, vertical scaling, manual pool scaling, and speed control from the API server ------- */
const controlSubscriber = redis.duplicate();
controlSubscriber.subscribe("simulator:control");
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

    if (command.action === "set-load" && typeof command.targetLoadFraction === "number") {
      const clamped = Math.min(2, Math.max(0, command.targetLoadFraction));
      instance.state.targetLoadFraction = clamped;
      const pct = Math.round(clamped * 100);
      instance.pendingLogs.push({
        timestamp: new Date().toISOString(),
        severity: clamped > 1 ? "warn" : "info",
        source: "load-tester",
        message: clamped > 1
          ? `load target raised to ${pct}% of declared capacity — exceeding design load`
          : `load target set to ${pct}% of declared capacity`
      });
      console.log(`[simulator] load target for ${command.deploymentId} set to ${pct}%`);
    } else if (command.action === "stop") {
      registry.delete(command.deploymentId);
      console.log(`[simulator] stopped ${command.deploymentId} — environment torn down`);
    } else if (command.action === "inject-chaos" && command.chaosType && command.resourceId) {
      const durationMap: Record<ChaosType, number> = {
        "crash": SIMULATION_CONSTANTS.CHAOS.CRASH_DURATION,
        "cpu-spike": SIMULATION_CONSTANTS.CHAOS.CPU_SPIKE_DURATION,
        "memory-leak": SIMULATION_CONSTANTS.CHAOS.MEMORY_LEAK_DURATION,
        "network-delay": SIMULATION_CONSTANTS.CHAOS.NETWORK_DELAY_DURATION,
        "disk-failure": SIMULATION_CONSTANTS.CHAOS.DISK_FAILURE_DURATION
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
        remainingTicks: durationTicks
      };
      instance.state.activeChaos.push(effect);
      console.log(`[simulator] chaos ${command.chaosType} injected on ${command.resourceId} for ${command.deploymentId}`);
    } else if (command.action === "scale-vertical" && command.resourceId && command.skuId) {
      const action: VerticalScaleAction = {
        resourceId: command.resourceId,
        toSkuId: command.skuId,
        downtimeTicks: SIMULATION_CONSTANTS.VERTICAL_SCALING.RESTART_TICKS,
        remainingTicks: SIMULATION_CONSTANTS.VERTICAL_SCALING.RESTART_TICKS
      };
      instance.state.verticalScaling.push(action);
      console.log(`[simulator] vertical scale ${command.resourceId} -> ${command.skuId} for ${command.deploymentId}`);
    } else if (command.action === "scale-pool" && command.lbId && (command.delta === 1 || command.delta === -1)) {
      const result = applyManualScale(instance.state, command.lbId, command.delta as 1 | -1);
      instance.state = result.state;
      instance.pendingLogs.push(result.log);
      console.log(`[simulator] manual scale ${command.delta === 1 ? "up" : "down"} on ${command.lbId} for ${command.deploymentId}`);
    } else if (command.action === "set-speed" && typeof command.speed === "number") {
      const validSpeeds = [0, 1, 10, 60];
      if (validSpeeds.includes(command.speed)) {
        instance.speed = command.speed;
        console.log(`[simulator] speed for ${command.deploymentId} set to ${command.speed}x`);
      } else {
        console.error(`[simulator] invalid speed ${command.speed} for ${command.deploymentId} — must be 0, 1, 10, or 60`);
      }
    }
  } catch (err: any) {
    console.error(`[simulator] control message failed: ${err.message}`);
  }
});

setInterval(async () => {
  for (const [deploymentId, instance] of registry) {
    try {
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
        instance.accumulatedCostUsd += computeHourlyBurnRateUsd(instance.state) / 3600;
      }

      // Build ONE snapshot per interval from the final state (instance.state
      // is the last tick's result.state), draining any queued control logs.
      const queuedLogs = instance.pendingLogs.splice(0);
      const poolData = buildPoolSnapshots(instance.state);
      const burnRate = computeHourlyBurnRateUsd(instance.state);
      const snapshot: SimulationSnapshot = {
        deploymentId,
        timestamp: new Date().toISOString(),
        simulatedSeconds: instance.state.simulatedSeconds,
        loadFraction: instance.state.loadFraction,
        metrics: instance.state.metrics,
        logs: [...queuedLogs, ...allLogs],
        health: instance.state.overallHealth,
        pools: poolData.pools,
        spawnedVms: poolData.spawnedVms,
        restarting: instance.state.verticalScaling.map(v => v.resourceId),
        speed: instance.speed,
        burnRatePerHourUsd: burnRate,
        accumulatedCostUsd: instance.accumulatedCostUsd
      };
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
          accumulatedCostUsd: instance.accumulatedCostUsd
        };
        await prisma.deployment.update({
          where: { id: deploymentId },
          data: { simulationState: checkpoint as any }
        });
      }
    } catch (err: any) {
      console.error(`[simulator] tick failed for ${deploymentId}: ${err.message}`);
    }
  }
}, 1000);