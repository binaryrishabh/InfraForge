import { prisma } from "../lib/prisma";
import { redis } from "../infra/redis";
import { publishSimulationSnapshot } from "../infra/pubsub";
import { createInitialState, tick } from "@shared/simulation/engine";
import { DEFAULT_WORKLOAD_PROFILE } from "@shared/constants/DEFAULT_WORKLOAD_PROFILE.constants";
import { SIMULATION_CONSTANTS } from "@shared/constants/SIMULATION_CONSTANTS.constants";
import type { SimulationState } from "@shared/interface/SimulationState.interface";
import type { ChaosType } from "@shared/types/ChaosType.types";
import type { ChaosEffect } from "@shared/interface/ChaosEffect.interface";
import type { SimulationSnapshot } from "@shared/interface/SimulationSnapshot.interface";
import type { SimulationLog } from "@shared/interface/SimulationLog.interface";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { WorkloadProfile } from "@shared/interface/WorkloadProfile.interface";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";

interface SimulationInstance {
  state: SimulationState;
  tickCount: number;
  pendingLogs: SimulationLog[];
}

const registry = new Map<string, SimulationInstance>();

const hashSeed = (seedText: string): number => {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = (Math.imul(31, hash) + seedText.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

export const startSimulation = async (deploymentId: string) => {
  if (registry.has(deploymentId)) return;
  const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
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
  registry.set(deploymentId, { state, tickCount: 0, pendingLogs: [] });
  console.log(`[simulator] registered ${deploymentId} | ${resources.length} resources | target ${Math.round(state.targetRps)} rps`);
};

export const stopSimulation = (deploymentId: string) => {
  registry.delete(deploymentId);
};

export const resurrectLiveDeployments = async () => {
  const liveDeployments = await prisma.deployment.findMany({ where: { status: DeploymentStatus.LIVE } });
  for (const deployment of liveDeployments) {
    await startSimulation(deployment.id);
  }
  if (liveDeployments.length > 0) {
    console.log(`[simulator] resurrected ${liveDeployments.length} live deployment(s)`);
  }
};

/* ------- Control channel: load adjustments, stop commands, and chaos injection from the API server ------- */
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
    }
  } catch (err: any) {
    console.error(`[simulator] control message failed: ${err.message}`);
  }
});

setInterval(async () => {
  for (const [deploymentId, instance] of registry) {
    try {
      const result = tick(instance.state, {});
      instance.state = result.state;
      instance.tickCount += 1;

      const queuedLogs = instance.pendingLogs.splice(0);

      const snapshot: SimulationSnapshot = {
        deploymentId,
        timestamp: new Date().toISOString(),
        simulatedSeconds: instance.state.simulatedSeconds,
        loadFraction: result.state.loadFraction,
        metrics: result.state.metrics,
        logs: [...queuedLogs, ...result.logs],
        health: result.state.overallHealth
      };
      await publishSimulationSnapshot(snapshot);

      if (instance.tickCount % 5 === 0) {
        await prisma.deployment.update({
          where: { id: deploymentId },
          data: { simulationState: instance.state as any }
        });
      }
    } catch (err: any) {
      console.error(`[simulator] tick failed for ${deploymentId}: ${err.message}`);
    }
  }
}, 1000);