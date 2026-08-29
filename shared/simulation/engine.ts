/*
InfraForge Simulation Engine — pure, deterministic, ZERO I/O.
tick(state, inputs) => { state, logs }
No Prisma, no Redis, no sockets inside this file. Ever.
All infrastructure access happens in the orchestrator that calls tick().
*/

import {
  RESOURCE_TYPES,
  type ResourceType,
} from "../constants/RESOURCE_TYPES.constants";
import {
  ResourceHealth,
  type ResourceHealthType,
} from "../enum/ResourceHealth.enum";
import { findSku } from "../catalog/index";
import { SIMULATION_CONSTANTS } from "../constants/SIMULATION_CONSTANTS.constants";
import { CAPACITY } from "../constants/CAPACITY.constants";
import { DeploymentChaosNames } from "../enum/DeploymentChaosNames.enum";
import type { TickResult } from "../interface/TickResult.interface";
import type { TickInputs } from "../interface/TickInputs.interface";
import type { SimulationState } from "../interface/SimulationState.interface";
import type { ChaosEffect } from "../interface/ChaosEffect.interface";
import type { PoolRuntime } from "../interface/PoolRuntime.interface";
import type { SpawnedVmInfo } from "../interface/SpawnedVmInfo.interface";
import type { VerticalScaleAction } from "../interface/VerticalScaleAction.interface";
import type { PoolSnapshot } from "../interface/PoolSnapshot.interface";
import type { Sku } from "../catalog/catalog.types";
import type { Resource } from "../interface/Resource.interface";
import type { ConnectionLine } from "../interface/ConnectionLine.interface";
import type { WorkloadProfile } from "../interface/WorkloadProfile.interface";
import type { ResourceMetrics } from "../interface/ResourceMetrics.interface";
import type { SimulationLog } from "../interface/SimulationLog.interface";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function burstFactor(seconds: number, profile: WorkloadProfile): number {
  if (profile.trafficShape !== "peak") return 1;
  const multiplier = profile.peakMultiplier ?? 3;
  const cyclePos = seconds % SIMULATION_CONSTANTS.BURST_CYCLE_SECONDS;
  const ramp = SIMULATION_CONSTANTS.BURST_RAMP_SECONDS;
  const duration = SIMULATION_CONSTANTS.BURST_DURATION_SECONDS;
  if (cyclePos < ramp) return 1 + (multiplier - 1) * (cyclePos / ramp);
  if (cyclePos < duration - ramp) return multiplier;
  if (cyclePos < duration)
    return 1 + (multiplier - 1) * ((duration - cyclePos) / ramp);
  return 1;
}

const chaosApplyMessage = (effect: ChaosEffect): string => {
  switch (effect.chaosType) {
    case DeploymentChaosNames.Crash:
      return `${effect.resourceId} crashed — process terminated, capacity removed`;
    case DeploymentChaosNames.CpuSpike:
      return `cpu spike injected on ${effect.resourceId} — runaway process detected`;
    case DeploymentChaosNames.MemoryLeak:
      return `memory leak injected on ${effect.resourceId} — heap growing unbounded`;
    case DeploymentChaosNames.NetworkDelay:
      return `network delay injected on ${effect.resourceId} — packets timing out`;
    case DeploymentChaosNames.DiskFailure:
      return `disk failure injected on ${effect.resourceId} — I/O thrashing`;
  }
};

export function createInitialState(
  deploymentId: string,
  resources: Resource[],
  connectionLines: ConnectionLine[],
  workloadProfile: WorkloadProfile,
  seed: number,
): SimulationState {
  const targets = new Set(connectionLines.map((c) => c.targetId));
  const entryTypes: ResourceType[] = [
    RESOURCE_TYPES.DNS,
    RESOURCE_TYPES.CDN,
    RESOURCE_TYPES.Firewall,
    RESOURCE_TYPES.LoadBalancer,
  ];
  const entryPoints = resources
    .filter(
      (r) =>
        entryTypes.includes(r.type) &&
        (r.type === RESOURCE_TYPES.DNS || !targets.has(r.id)),
    )
    .map((r) => r.id);

  const adjacency: Record<string, string[]> = {};
  for (const c of connectionLines) {
    (adjacency[c.sourceId] ??= []).push(c.targetId);
  }
  const reachable = new Set<string>();
  const queue = [...entryPoints];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of adjacency[id] ?? []) queue.push(next);
  }

  const deadEnds = resources
    .filter(
      (r) =>
        r.type === RESOURCE_TYPES.VirtualMachine &&
        reachable.has(r.id) &&
        (adjacency[r.id] ?? []).length === 0,
    )
    .map((r) => r.id);
  const idle = resources.filter((r) => !reachable.has(r.id)).map((r) => r.id);

  const targetRps =
    workloadProfile.throughputUnit === "per-minute"
      ? workloadProfile.targetThroughput / 60
      : workloadProfile.targetThroughput / 3600;

  const resourceTypes: Record<string, ResourceType> = {};
  const resourceSkus: Record<string, Sku> = {};
  const metrics: Record<string, ResourceMetrics> = {};
  for (const r of resources) {
    resourceTypes[r.id] = r.type;
    metrics[r.id] = { cpu: 0, memory: 0, health: ResourceHealth.HEALTHY };
    if (r.skuId) {
      const sku = findSku(r.skuId);
      if (sku) resourceSkus[r.id] = sku;
    }
  }

  const pools: Record<string, PoolRuntime> = {};
  for (const lb of resources) {
    if (lb.type !== RESOURCE_TYPES.LoadBalancer) continue;
    const poolVmIds = (adjacency[lb.id] ?? []).filter(
      (id) => resourceTypes[id] === RESOURCE_TYPES.VirtualMachine,
    );
    if (poolVmIds.length === 0) continue;
    const policy = lb.autoscaling;
    if (policy?.enabled === false) continue;
    const base = poolVmIds.length;
    const minReplicas = policy?.minReplicas ?? base;
    const maxReplicas = Math.max(
      minReplicas,
      Math.min(
        policy?.maxReplicas ??
          base * SIMULATION_CONSTANTS.AUTOSCALING.DEFAULT_MAX_MULTIPLIER,
        SIMULATION_CONSTANTS.AUTOSCALING.DEFAULT_MAX_CAP,
      ),
    );
    const basePositions = poolVmIds
      .map((id) => resources.find((r) => r.id === id))
      .filter((r): r is Resource => Boolean(r));
    pools[lb.id] = {
      lbId: lb.id,
      baseVmIds: poolVmIds,
      minReplicas,
      maxReplicas,
      targetCpu:
        policy?.targetCpu ??
        SIMULATION_CONSTANTS.AUTOSCALING.DEFAULT_TARGET_CPU,
      hotTicks: 0,
      coldTicks: 0,
      spawnCounter: 0,
      spawnOrigin: {
        x: basePositions[0]?.x ?? 200,
        y: Math.max(...basePositions.map((r) => r.y), 0),
      },
      pending: null,
    };
  }

  return {
    deploymentId,
    seed,
    simulatedSeconds: 0,
    loadFraction: 0,
    targetLoadFraction: 1,
    targetRps,
    workloadProfile,
    resourceTypes,
    resourceSkus,
    entryPoints,
    reachable: [...reachable],
    deadEnds,
    idle,
    metrics,
    overallHealth: "healthy",
    activeChaos: [],
    pools,
    spawnedVms: [],
    verticalScaling: [],
  };
}

export function tick(state: SimulationState, inputs: TickInputs): TickResult {
  const logs: SimulationLog[] = [];
  const seconds = state.simulatedSeconds + 1;
  const now = new Date().toISOString();
  const profile = state.workloadProfile;

  // 1. Slider-driven load target
  let targetLoadFraction =
    inputs.targetLoadFraction ?? state.targetLoadFraction;
  targetLoadFraction = Math.min(
    SIMULATION_CONSTANTS.MAX_LOAD_FRACTION,
    Math.max(0, targetLoadFraction),
  );
  const rampStep = 1 / SIMULATION_CONSTANTS.RAMP_SECONDS;
  let loadFraction = state.loadFraction;
  if (loadFraction < targetLoadFraction)
    loadFraction = Math.min(targetLoadFraction, loadFraction + rampStep);
  else if (loadFraction > targetLoadFraction)
    loadFraction = Math.max(targetLoadFraction, loadFraction - rampStep * 2);

  // 2. Burst windows
  const burstNow = burstFactor(seconds, profile);
  const burstPrev = burstFactor(seconds - 1, profile);
  const effectiveMultiplier = Math.min(
    SIMULATION_CONSTANTS.MAX_EFFECTIVE_LOAD,
    loadFraction * burstNow,
  );
  const totalRps = state.targetRps * effectiveMultiplier;

  if (profile.trafficShape === "peak") {
    const peak = profile.peakMultiplier ?? 3;
    if (burstPrev <= 1.01 && burstNow > 1.01) {
      logs.push({
        timestamp: now,
        severity: "warn",
        source: "load-generator",
        message: `traffic burst beginning — ${peak}x declared base load`,
      });
    } else if (burstPrev > 1.01 && burstNow <= 1.01) {
      logs.push({
        timestamp: now,
        severity: "info",
        source: "load-generator",
        message: "burst subsided — traffic returning to base level",
      });
    }
  }

  // 3. Workload mix
  const readFraction = profile.readWriteRatio ?? 0.8;
  const writeFraction = 1 - readFraction;
  const payloadKB = SIMULATION_CONSTANTS.PAYLOAD_KB[profile.payloadSize];
  const dbLoadFactor =
    readFraction * (1 - SIMULATION_CONSTANTS.CACHE_HIT_RATIO) +
    writeFraction * SIMULATION_CONSTANTS.WRITE_COST_FACTOR;

  const rng = mulberry32(state.seed * 100003 + seconds);
  const jitter = () => 1 + (rng() - 0.5) * 0.06;

  // 4. Index active chaos and vertical scaling
  const chaosByResource: Record<string, ChaosEffect[]> = {};
  for (const effect of state.activeChaos)
    (chaosByResource[effect.resourceId] ??= []).push(effect);
  const downResources = new Set(
    state.activeChaos
      .filter((e) => e.chaosType === "crash")
      .map((e) => e.resourceId),
  );
  const restartingResources = new Set(
    state.verticalScaling.map((v) => v.resourceId),
  );

  // 5. Distribute load — exclude crashed AND restarting resources from serving
  const reachableSet = new Set(state.reachable);
  const activeSpawned = state.spawnedVms.filter((v) => v.status === "active");
  const activeSpawnedIds = new Set(activeSpawned.map((v) => v.id));
  const vmIds = [
    ...state.reachable.filter(
      (id) => state.resourceTypes[id] === RESOURCE_TYPES.VirtualMachine,
    ),
    ...activeSpawned.map((v) => v.id),
  ].filter((id) => !downResources.has(id) && !restartingResources.has(id));
  const cacheIds = state.reachable.filter(
    (id) => state.resourceTypes[id] === RESOURCE_TYPES.Cache,
  );
  const rpsPerVm = vmIds.length > 0 ? totalRps / vmIds.length : 0;

  const newMetrics: Record<string, ResourceMetrics> = {};
  for (const resourceId of Object.keys(state.resourceTypes)) {
    const type = state.resourceTypes[resourceId];
    if (!type) continue;
    const capacity = CAPACITY[type];
    const sku = state.resourceSkus[resourceId];

    let cpu = 0,
      memory = 0,
      rps = 0;
    let connections: number | undefined;

    const isServing =
      (reachableSet.has(resourceId) || activeSpawnedIds.has(resourceId)) &&
      !restartingResources.has(resourceId);
    if (!isServing) {
      cpu = type === RESOURCE_TYPES.MonitoringAgent ? 12 : 2;
      memory = type === RESOURCE_TYPES.MonitoringAgent ? 18 : 8;
    } else {
      switch (type) {
        case RESOURCE_TYPES.VirtualMachine: {
          rps = rpsPerVm;
          const vmCapacity = sku
            ? sku.vCpu * sku.baselineFactor * SIMULATION_CONSTANTS.RPS_PER_VCPU
            : capacity.rps;
          cpu =
            (rps / vmCapacity) *
            100 *
            (1 + writeFraction * SIMULATION_CONSTANTS.VM_WRITE_CPU_TAX);
          memory = 25 + cpu * 0.5;
          connections = Math.ceil(rps / 10);
          break;
        }
        case RESOURCE_TYPES.Database: {
          rps = totalRps * dbLoadFactor;
          const dbCapacity = sku
            ? sku.vCpu * sku.baselineFactor * SIMULATION_CONSTANTS.QPS_PER_VCPU
            : capacity.rps;
          cpu = (rps / dbCapacity) * 100;
          connections = vmIds.length * SIMULATION_CONSTANTS.DB_POOL_PER_VM;
          memory = 30 + cpu * 0.4;
          const maxConn =
            sku?.maxConnections ?? SIMULATION_CONSTANTS.MAX_DB_CONNECTIONS;
          if (connections > maxConn) cpu = Math.max(cpu, 95);
          break;
        }
        case RESOURCE_TYPES.Cache: {
          rps = totalRps;
          cpu = (rps / capacity.rps) * 100;
          memory = 35 + effectiveMultiplier * 25 + writeFraction * 10;
          break;
        }
        case RESOURCE_TYPES.MonitoringAgent: {
          cpu = 12;
          memory = 18;
          break;
        }
        default: {
          rps = totalRps;
          cpu = (rps / capacity.rps) * 100;
          memory = 20 + cpu * 0.3;
        }
      }

      let bandCap = (
        SIMULATION_CONSTANTS.BANDWIDTH_CAPACITY_KBPS as Record<string, number>
      )[type];
      if (sku?.networkGbps)
        bandCap = sku.networkGbps * SIMULATION_CONSTANTS.KBPS_PER_GBPS;
      if (bandCap && rps > 0) {
        const bandUtil = ((rps * payloadKB) / bandCap) * 100;
        if (bandUtil > cpu) cpu = bandUtil;
      }
    }

    // 6. Apply chaos effects
    const effects = chaosByResource[resourceId];
    let crashed = false;
    if (effects) {
      for (const effect of effects) {
        switch (effect.chaosType) {
          case "crash":
            crashed = true;
            break;
          case "cpu-spike":
            cpu += SIMULATION_CONSTANTS.CHAOS.CPU_SPIKE_BOOST;
            break;
          case "memory-leak": {
            const elapsed = effect.durationTicks - effect.remainingTicks;
            memory += elapsed * SIMULATION_CONSTANTS.CHAOS.MEMORY_LEAK_RATE;
            break;
          }
          case "network-delay":
            cpu = cpu * SIMULATION_CONSTANTS.CHAOS.NETWORK_DELAY_CPU_FACTOR;
            break;
          case "disk-failure":
            cpu = 100;
            break;
        }
      }
    }
    if (crashed) {
      cpu = 0;
      memory = 0;
      rps = 0;
      connections = undefined;
    }

    // 6b. Restarting resources are offline for the SKU swap window
    const isRestarting = restartingResources.has(resourceId);
    if (isRestarting) {
      cpu = 0;
      memory = 0;
      rps = 0;
      connections = undefined;
    }

    cpu = Math.min(100, Math.max(0, cpu * jitter()));
    memory = Math.min(100, Math.max(0, memory * jitter()));

    let health: ResourceHealthType;
    if (crashed) health = ResourceHealth.FAILED;
    else if (isRestarting) health = ResourceHealth.FAILED;
    else if (cpu >= SIMULATION_CONSTANTS.SATURATED_AT || memory >= 97)
      health = ResourceHealth.SATURATED;
    else if (cpu >= SIMULATION_CONSTANTS.DEGRADED_AT)
      health = ResourceHealth.DEGRADED;
    else health = ResourceHealth.HEALTHY;

    const metric: ResourceMetrics = {
      cpu: round1(cpu),
      memory: round1(memory),
      health,
    };
    if (rps > 0) metric.rps = Math.round(rps);
    if (connections !== undefined) metric.connections = connections;
    newMetrics[resourceId] = metric;
  }

  // 7. Chaos lifecycle
  const nextActiveChaos: ChaosEffect[] = [];
  for (const effect of state.activeChaos) {
    const isFirstTick = effect.remainingTicks === effect.durationTicks;
    if (isFirstTick)
      logs.push({
        timestamp: now,
        severity: "error",
        resourceId: effect.resourceId,
        source: "chaos",
        message: chaosApplyMessage(effect),
      });
    const remaining = effect.remainingTicks - 1;
    if (remaining <= 0)
      logs.push({
        timestamp: now,
        severity: "info",
        resourceId: effect.resourceId,
        source: "chaos",
        message: `${effect.resourceId} recovered from ${effect.chaosType}`,
      });
    else nextActiveChaos.push({ ...effect, remainingTicks: remaining });
  }

  // 8. Autoscaler
  let nextSpawnedVms: SpawnedVmInfo[] = state.spawnedVms.map((v) => ({ ...v }));
  let nextResourceTypes = state.resourceTypes;
  let nextResourceSkus = state.resourceSkus;
  const nextPools: Record<string, PoolRuntime> = {};

  for (const [lbId, pool] of Object.entries(state.pools)) {
    const p: PoolRuntime = {
      ...pool,
      pending: pool.pending ? { ...pool.pending } : null,
    };
    const alivePoolVmIds = [
      ...p.baseVmIds,
      ...nextSpawnedVms
        .filter((v) => v.poolId === lbId && v.status === "active")
        .map((v) => v.id),
    ].filter((id) => !downResources.has(id) && !restartingResources.has(id));
    const cpus = alivePoolVmIds.map((id) => newMetrics[id]?.cpu ?? 0);
    const avgCpu =
      cpus.length > 0 ? cpus.reduce((a, b) => a + b, 0) / cpus.length : 0;
    const totalReplicas =
      p.baseVmIds.length +
      nextSpawnedVms.filter((v) => v.poolId === lbId).length;

    if (p.pending) {
      p.pending.ticksRemaining -= 1;
      if (p.pending.ticksRemaining <= 0) {
        if (p.pending.action === "up") {
          nextResourceTypes = { ...nextResourceTypes };
          nextResourceSkus = { ...nextResourceSkus };
          const templateId = p.baseVmIds[0]!;
          const templateSku = nextResourceSkus[templateId];
          for (const v of nextSpawnedVms) {
            if (v.poolId === lbId && v.status === "provisioning") {
              v.status = "active";
              nextResourceTypes[v.id] = RESOURCE_TYPES.VirtualMachine;
              if (templateSku) nextResourceSkus[v.id] = templateSku;
              logs.push({
                timestamp: now,
                severity: "info",
                resourceId: v.id,
                source: "autoscaler",
                message: `${v.id} joined pool ${lbId} — traffic redistributing`,
              });
            }
          }
        } else {
          const activeInPool = nextSpawnedVms.filter(
            (v) => v.poolId === lbId && v.status === "active",
          );
          const victim = activeInPool[activeInPool.length - 1];
          if (victim) {
            nextSpawnedVms = nextSpawnedVms.filter((v) => v.id !== victim.id);
            if (nextResourceTypes[victim.id]) {
              nextResourceTypes = { ...nextResourceTypes };
              delete nextResourceTypes[victim.id];
              nextResourceSkus = { ...nextResourceSkus };
              delete nextResourceSkus[victim.id];
            }
            logs.push({
              timestamp: now,
              severity: "info",
              resourceId: victim.id,
              source: "autoscaler",
              message: `${victim.id} drained and removed — pool ${lbId} back to ${totalReplicas - 1} replicas`,
            });
          }
        }
        p.pending = null;
      }
    } else if (avgCpu > p.targetCpu) {
      p.hotTicks += 1;
      p.coldTicks = 0;
      if (p.hotTicks >= SIMULATION_CONSTANTS.AUTOSCALING.HOT_TICKS) {
        if (totalReplicas < p.maxReplicas) {
          p.hotTicks = 0;
          p.pending = {
            action: "up",
            ticksRemaining: SIMULATION_CONSTANTS.AUTOSCALING.PROVISION_TICKS,
          };
          p.spawnCounter += 1;
          const newId = `${p.baseVmIds[0]!}-asg-${p.spawnCounter}`;
          nextSpawnedVms = [
            ...nextSpawnedVms,
            {
              id: newId,
              poolId: lbId,
              x: p.spawnOrigin.x,
              y:
                p.spawnOrigin.y +
                SIMULATION_CONSTANTS.AUTOSCALING.SPAWN_Y_GAP * p.spawnCounter,
              status: "provisioning",
              spawnedAtTick: seconds,
            },
          ];
          logs.push({
            timestamp: now,
            severity: "warn",
            source: "autoscaler",
            message: `pool ${lbId} avg cpu ${round1(avgCpu)}% above target ${p.targetCpu}% — provisioning new instance (${SIMULATION_CONSTANTS.AUTOSCALING.PROVISION_TICKS}s)`,
          });
        } else {
          p.hotTicks = SIMULATION_CONSTANTS.AUTOSCALING.HOT_TICKS;
        }
      }
    } else if (avgCpu < SIMULATION_CONSTANTS.AUTOSCALING.SCALE_DOWN_AT) {
      p.coldTicks += 1;
      p.hotTicks = 0;
      const activeSpawnedCount = nextSpawnedVms.filter(
        (v) => v.poolId === lbId && v.status === "active",
      ).length;
      if (
        p.coldTicks >= SIMULATION_CONSTANTS.AUTOSCALING.COLD_TICKS &&
        activeSpawnedCount > 0 &&
        totalReplicas > p.minReplicas
      ) {
        p.coldTicks = 0;
        p.pending = {
          action: "down",
          ticksRemaining: SIMULATION_CONSTANTS.AUTOSCALING.DRAIN_TICKS,
        };
        logs.push({
          timestamp: now,
          severity: "info",
          source: "autoscaler",
          message: `pool ${lbId} running cold at ${round1(avgCpu)}% — draining one instance`,
        });
      }
    } else {
      p.hotTicks = 0;
      p.coldTicks = 0;
    }
    nextPools[lbId] = p;
  }

  // 8b. Vertical scaling lifecycle — downtime countdown, then live SKU swap
  const nextVerticalScaling: VerticalScaleAction[] = [];
  for (const action of state.verticalScaling) {
    const isFirstTick = action.remainingTicks === action.downtimeTicks;
    if (isFirstTick) {
      logs.push({
        timestamp: now,
        severity: "warn",
        resourceId: action.resourceId,
        source: "autoscaler",
        message: `${action.resourceId} scaling vertically to ${action.toSkuId} — restarting (${action.downtimeTicks}s downtime)`,
      });
    }
    const remaining = action.remainingTicks - 1;
    if (remaining <= 0) {
      nextResourceSkus = { ...nextResourceSkus };
      const newSku = findSku(action.toSkuId);
      if (newSku) nextResourceSkus[action.resourceId] = newSku;
      logs.push({
        timestamp: now,
        severity: "info",
        resourceId: action.resourceId,
        source: "autoscaler",
        message: `${action.resourceId} back online at ${action.toSkuId}`,
      });
    } else {
      nextVerticalScaling.push({ ...action, remainingTicks: remaining });
    }
  }

  // 9. Threshold-crossing logs
  for (const [resourceId, metric] of Object.entries(newMetrics)) {
    const before = state.metrics[resourceId]?.health ?? ResourceHealth.HEALTHY;
    const after = metric.health;
    if (before === after) continue;
    const type = state.resourceTypes[resourceId];
    const source = type ? CAPACITY[type].source : "app";
    let severity: "info" | "warn" | "error" = "info";
    let message = `utilization recovered on ${resourceId} — cpu ${metric.cpu}%`;
    if (after === ResourceHealth.DEGRADED) {
      severity = "warn";
      message = `cpu at ${metric.cpu}% on ${resourceId} — approaching saturation`;
    } else if (after === ResourceHealth.SATURATED) {
      severity = "error";
      message = `${resourceId} saturated — cpu ${metric.cpu}%, requests queueing`;
    } else if (after === ResourceHealth.FAILED) {
      severity = "error";
      message = `${resourceId} is down`;
    }
    logs.push({ timestamp: now, severity, resourceId, source, message });
  }

  // 10. One-time structural logs
  if (seconds === 1) {
    logs.push({
      timestamp: now,
      severity: "info",
      source: "simulator",
      message: `simulation started — target ${Math.round(state.targetRps)} rps | ${profile.trafficShape === "peak" ? `peak bursts ${profile.peakMultiplier ?? 3}x` : "steady traffic"} | ${Math.round(readFraction * 100)}% reads | ${profile.payloadSize} payloads | ramping over ${SIMULATION_CONSTANTS.RAMP_SECONDS}s`,
    });
    for (const [lbId, pool] of Object.entries(nextPools)) {
      logs.push({
        timestamp: now,
        severity: "info",
        source: "autoscaler",
        message: `pool ${lbId} formed — ${pool.baseVmIds.length} base replicas, autoscale ${pool.minReplicas}-${pool.maxReplicas} at ${pool.targetCpu}% target`,
      });
    }
    for (const id of state.deadEnds) {
      logs.push({
        timestamp: now,
        severity: "warn",
        resourceId: id,
        source: "nginx",
        message: `${id} has no downstream data path — requests requiring data will fail`,
      });
    }
  }

  // 11. Overall health
  const healths = Object.values(newMetrics).map((m) => m.health);
  let overallHealth: SimulationState["overallHealth"] = "healthy";
  if (healths.includes(ResourceHealth.FAILED)) overallHealth = "critical";
  else if (healths.includes(ResourceHealth.SATURATED))
    overallHealth = "saturated";
  else if (healths.includes(ResourceHealth.DEGRADED))
    overallHealth = "degraded";

  return {
    state: {
      ...state,
      simulatedSeconds: seconds,
      loadFraction: round1(loadFraction * 100) / 100,
      targetLoadFraction,
      resourceTypes: nextResourceTypes,
      resourceSkus: nextResourceSkus,
      metrics: newMetrics,
      overallHealth,
      activeChaos: nextActiveChaos,
      pools: nextPools,
      spawnedVms: nextSpawnedVms,
      verticalScaling: nextVerticalScaling,
    },
    logs,
  };
}

export function buildPoolSnapshots(state: SimulationState): {
  pools: Record<string, PoolSnapshot>;
  spawnedVms: SpawnedVmInfo[];
} {
  const pools: Record<string, PoolSnapshot> = {};
  for (const [lbId, p] of Object.entries(state.pools)) {
    const activeCount =
      p.baseVmIds.length +
      state.spawnedVms.filter((v) => v.poolId === lbId && v.status === "active")
        .length;
    pools[lbId] = {
      lbId,
      baseVmIds: p.baseVmIds,
      currentReplicas: activeCount,
      minReplicas: p.minReplicas,
      maxReplicas: p.maxReplicas,
      targetCpu: p.targetCpu,
      pending: p.pending
        ? {
            action: p.pending.action,
            secondsRemaining: p.pending.ticksRemaining,
          }
        : null,
    };
  }
  return { pools, spawnedVms: state.spawnedVms };
}

/* ---------------- Manual scaling — the operator's hand on the pool ----------------
Pure decision function. Reuses the autoscaler's provisioning and drain
machinery so manual and automatic scaling share one code path. Refusals
are honest: max cap, protected base replicas, and already-scaling pools. */
export function applyManualScale(
  state: SimulationState,
  lbId: string,
  delta: 1 | -1,
): { state: SimulationState; log: SimulationLog } {
  const now = new Date().toISOString();
  const pool = state.pools[lbId];

  if (!pool) {
    return {
      state,
      log: { timestamp: now, severity: "warn", source: "operator", message: `no pool found at ${lbId} — manual scale ignored` },
    };
  }

  if (pool.pending) {
    return {
      state,
      log: { timestamp: now, severity: "warn", source: "operator", message: `pool ${lbId} is already scaling — manual command refused` },
    };
  }

  const spawnedInPool = state.spawnedVms.filter((v) => v.poolId === lbId);
  const totalReplicas = pool.baseVmIds.length + spawnedInPool.length;
  const activeSpawnedCount = spawnedInPool.filter((v) => v.status === "active").length;

  if (delta === 1) {
    if (totalReplicas >= pool.maxReplicas) {
      return {
        state,
        log: { timestamp: now, severity: "warn", source: "operator", message: `pool ${lbId} at max replicas (${pool.maxReplicas}) — manual scale-up refused` },
      };
    }
    const spawnCounter = pool.spawnCounter + 1;
    const newId = `${pool.baseVmIds[0]!}-asg-${spawnCounter}`;
    const ghost: SpawnedVmInfo = {
      id: newId,
      poolId: lbId,
      x: pool.spawnOrigin.x,
      y: pool.spawnOrigin.y + SIMULATION_CONSTANTS.AUTOSCALING.SPAWN_Y_GAP * spawnCounter,
      status: "provisioning",
      spawnedAtTick: state.simulatedSeconds,
    };
    return {
      state: {
        ...state,
        spawnedVms: [...state.spawnedVms, ghost],
        pools: {
          ...state.pools,
          [lbId]: {
            ...pool,
            spawnCounter,
            pending: { action: "up", ticksRemaining: SIMULATION_CONSTANTS.AUTOSCALING.PROVISION_TICKS },
          },
        },
      },
      log: { timestamp: now, severity: "info", source: "operator", message: `manual scale-up on ${lbId} — provisioning replica ${totalReplicas + 1} (${SIMULATION_CONSTANTS.AUTOSCALING.PROVISION_TICKS}s)` },
    };
  }

  if (activeSpawnedCount === 0 || totalReplicas <= pool.minReplicas) {
    return {
      state,
      log: { timestamp: now, severity: "warn", source: "operator", message: `pool ${lbId} has no scalable replicas — base replicas are protected` },
    };
  }

  return {
    state: {
      ...state,
      pools: {
        ...state.pools,
        [lbId]: {
          ...pool,
          pending: { action: "down", ticksRemaining: SIMULATION_CONSTANTS.AUTOSCALING.DRAIN_TICKS },
        },
      },
    },
    log: { timestamp: now, severity: "info", source: "operator", message: `manual scale-down on ${lbId} — draining one replica` },
  };
}