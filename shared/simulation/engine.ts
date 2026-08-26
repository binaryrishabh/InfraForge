/*
InfraForge Simulation Engine — pure, deterministic, ZERO I/O.
tick(state, inputs) => { state, logs }
No Prisma, no Redis, no sockets inside this file. Ever.
All infrastructure access happens in the orchestrator that calls tick().
*/

import { RESOURCE_TYPES, type ResourceType } from "../constants/RESOURCE_TYPES.constants";
import { ResourceHealth, type ResourceHealthType } from "../enum/ResourceHealth.enum";
import { findSku } from "../catalog/index";
import type { Sku } from "../catalog/catalog.types";
import type { Resource } from "../types/Resource.types";
import type { ConnectionLine } from "../types/ConnectionLine.types";
import type { WorkloadProfile } from "../types/WorkloadProfile.types";
import type { ResourceMetrics } from "../types/ResourceMetrics.types";
import type { SimulationLog } from "../types/SimulationLog.types";

/* ---------------- Simulation tuning constants ----------------
Single home for every tuning number. Capacity TRUTH now comes from the
SKU catalog wherever a resource carries a skuId; these constants are the
physics that convert real specs (vCPU, baseline, network) into load. */
export const SIMULATION_CONSTANTS = {
  RAMP_SECONDS: 60,
  MAX_LOAD_FRACTION: 2.0,
  MAX_EFFECTIVE_LOAD: 3.0,
  DEGRADED_AT: 70,
  SATURATED_AT: 90,
  CACHE_HIT_RATIO: 0.8,
  DB_POOL_PER_VM: 20,
  MAX_DB_CONNECTIONS: 100,
  WRITE_COST_FACTOR: 2,
  VM_WRITE_CPU_TAX: 0.3,
  BURST_CYCLE_SECONDS: 120,
  BURST_DURATION_SECONDS: 20,
  BURST_RAMP_SECONDS: 5,
  RPS_PER_VCPU: 80,           // typical web workload at 100% of one vCPU
  QPS_PER_VCPU: 125,          // typical OLTP workload at 100% of one DB vCPU
  KBPS_PER_GBPS: 125_000,     // 1 Gbps = 125,000 KB/s
  PAYLOAD_KB: { light: 10, medium: 100, heavy: 1024 },
  BANDWIDTH_CAPACITY_KBPS: {   // generic fallback when no SKU is selected
    "Virtual Machine": 125_000,
    "Load Balancer": 250_000,
    "CDN": 1_000_000,
    "Object Storage": 500_000
  }
} as const;

export const DEFAULT_WORKLOAD_PROFILE: WorkloadProfile = {
  targetThroughput: 1_000_000,
  throughputUnit: "per-hour",
  trafficShape: "steady",
  payloadSize: "medium"
};

// Generic fallback capacity for resources WITHOUT a selected SKU.
// Audit: deleted category-by-category as the catalog expands.
const CAPACITY: Record<ResourceType, { rps: number; source: string }> = {
  [RESOURCE_TYPES.DNS]: { rps: 5000, source: "named" },
  [RESOURCE_TYPES.CDN]: { rps: 20000, source: "edge" },
  [RESOURCE_TYPES.Firewall]: { rps: 15000, source: "waf" },
  [RESOURCE_TYPES.LoadBalancer]: { rps: 10000, source: "nginx" },
  [RESOURCE_TYPES.VirtualMachine]: { rps: 160, source: "app" },
  [RESOURCE_TYPES.ContainerRegistry]: { rps: 1000, source: "registry" },
  [RESOURCE_TYPES.Cache]: { rps: 8000, source: "redis" },
  [RESOURCE_TYPES.Database]: { rps: 250, source: "postgres" },
  [RESOURCE_TYPES.ObjectStorage]: { rps: 2000, source: "storage" },
  [RESOURCE_TYPES.MessageQueue]: { rps: 5000, source: "rabbitmq" },
  [RESOURCE_TYPES.MonitoringAgent]: { rps: 10000, source: "agent" }
};

/* ---------------- State ---------------- */

export interface SimulationState {
  deploymentId: string;
  seed: number;
  simulatedSeconds: number;
  loadFraction: number;
  targetLoadFraction: number;
  targetRps: number;
  workloadProfile: WorkloadProfile;
  resourceTypes: Record<string, ResourceType>;
  resourceSkus: Record<string, Sku>;
  entryPoints: string[];
  reachable: string[];
  deadEnds: string[];
  idle: string[];
  metrics: Record<string, ResourceMetrics>;
  overallHealth: "healthy" | "degraded" | "saturated" | "critical";
}

export interface TickInputs {
  targetLoadFraction?: number;
}

export interface TickResult {
  state: SimulationState;
  logs: SimulationLog[];
}

/* ---------------- Deterministic jitter (seeded, replay-safe) ---------------- */

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ---------------- Burst windows for peak traffic shapes ---------------- */

function burstFactor(seconds: number, profile: WorkloadProfile): number {
  if (profile.trafficShape !== "peak") return 1;
  const multiplier = profile.peakMultiplier ?? 3;
  const cyclePos = seconds % SIMULATION_CONSTANTS.BURST_CYCLE_SECONDS;
  const ramp = SIMULATION_CONSTANTS.BURST_RAMP_SECONDS;
  const duration = SIMULATION_CONSTANTS.BURST_DURATION_SECONDS;
  if (cyclePos < ramp) return 1 + (multiplier - 1) * (cyclePos / ramp);
  if (cyclePos < duration - ramp) return multiplier;
  if (cyclePos < duration) return 1 + (multiplier - 1) * ((duration - cyclePos) / ramp);
  return 1;
}

/* ---------------- Initial state: traffic path v1 ---------------- */

export function createInitialState(
  deploymentId: string,
  resources: Resource[],
  connectionLines: ConnectionLine[],
  workloadProfile: WorkloadProfile,
  seed: number
): SimulationState {
  const targets = new Set(connectionLines.map(c => c.targetId));
  const entryTypes: ResourceType[] = [
    RESOURCE_TYPES.DNS,
    RESOURCE_TYPES.CDN,
    RESOURCE_TYPES.Firewall,
    RESOURCE_TYPES.LoadBalancer
  ];
  const entryPoints = resources
    .filter(r => entryTypes.includes(r.type) && (r.type === RESOURCE_TYPES.DNS || !targets.has(r.id)))
    .map(r => r.id);

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
    .filter(r =>
      r.type === RESOURCE_TYPES.VirtualMachine &&
      reachable.has(r.id) &&
      (adjacency[r.id] ?? []).length === 0
    )
    .map(r => r.id);

  const idle = resources.filter(r => !reachable.has(r.id)).map(r => r.id);

  const targetRps = workloadProfile.throughputUnit === "per-minute"
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
    overallHealth: "healthy"
  };
}

/* ---------------- The tick ---------------- */

export function tick(state: SimulationState, inputs: TickInputs): TickResult {
  const logs: SimulationLog[] = [];
  const seconds = state.simulatedSeconds + 1;
  const now = new Date().toISOString();
  const profile = state.workloadProfile;

  // 1. Slider-driven load target (ramp up slow, shed fast)
  let targetLoadFraction = inputs.targetLoadFraction ?? state.targetLoadFraction;
  targetLoadFraction = Math.min(SIMULATION_CONSTANTS.MAX_LOAD_FRACTION, Math.max(0, targetLoadFraction));
  const rampStep = 1 / SIMULATION_CONSTANTS.RAMP_SECONDS;
  let loadFraction = state.loadFraction;
  if (loadFraction < targetLoadFraction) {
    loadFraction = Math.min(targetLoadFraction, loadFraction + rampStep);
  } else if (loadFraction > targetLoadFraction) {
    loadFraction = Math.max(targetLoadFraction, loadFraction - rampStep * 2);
  }

  // 2. Burst windows — peak traffic shapes produce recurring storms
  const burstNow = burstFactor(seconds, profile);
  const burstPrev = burstFactor(seconds - 1, profile);
  const effectiveMultiplier = Math.min(SIMULATION_CONSTANTS.MAX_EFFECTIVE_LOAD, loadFraction * burstNow);
  const totalRps = state.targetRps * effectiveMultiplier;

  if (profile.trafficShape === "peak") {
    const peak = profile.peakMultiplier ?? 3;
    if (burstPrev <= 1.01 && burstNow > 1.01) {
      logs.push({ timestamp: now, severity: "warn", source: "load-generator", message: `traffic burst beginning — ${peak}x declared base load` });
    } else if (burstPrev > 1.01 && burstNow <= 1.01) {
      logs.push({ timestamp: now, severity: "info", source: "load-generator", message: "burst subsided — traffic returning to base level" });
    }
  }

  // 3. Workload mix — reads vs writes vs payload weight
  const readFraction = profile.readWriteRatio ?? 0.8;
  const writeFraction = 1 - readFraction;
  const payloadKB = SIMULATION_CONSTANTS.PAYLOAD_KB[profile.payloadSize];
  const dbLoadFactor = readFraction * (1 - SIMULATION_CONSTANTS.CACHE_HIT_RATIO) + writeFraction * SIMULATION_CONSTANTS.WRITE_COST_FACTOR;

  const rng = mulberry32(state.seed * 100003 + seconds);
  const jitter = () => 1 + (rng() - 0.5) * 0.06;

  // 4. Distribute load across the reachable graph
  const reachableSet = new Set(state.reachable);
  const vmIds = state.reachable.filter(id => state.resourceTypes[id] === RESOURCE_TYPES.VirtualMachine);
  const cacheIds = state.reachable.filter(id => state.resourceTypes[id] === RESOURCE_TYPES.Cache);
  const rpsPerVm = vmIds.length > 0 ? totalRps / vmIds.length : 0;

  const newMetrics: Record<string, ResourceMetrics> = {};
  for (const resourceId of Object.keys(state.resourceTypes)) {
    const type = state.resourceTypes[resourceId];
    if (!type) continue;
    const capacity = CAPACITY[type];
    const sku = state.resourceSkus[resourceId];

    let cpu = 0;
    let memory = 0;
    let rps = 0;
    let connections: number | undefined;

    if (!reachableSet.has(resourceId)) {
      cpu = type === RESOURCE_TYPES.MonitoringAgent ? 12 : 2;
      memory = type === RESOURCE_TYPES.MonitoringAgent ? 18 : 8;
    } else {
      switch (type) {
        case RESOURCE_TYPES.VirtualMachine: {
          rps = rpsPerVm;
          // SKU truth: real cores x real baseline x physics. Else generic fallback.
          const vmCapacity = sku
            ? sku.vCpu * sku.baselineFactor * SIMULATION_CONSTANTS.RPS_PER_VCPU
            : capacity.rps;
          cpu = (rps / vmCapacity) * 100 * (1 + writeFraction * SIMULATION_CONSTANTS.VM_WRITE_CPU_TAX);
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
          const maxConn = sku?.maxConnections ?? SIMULATION_CONSTANTS.MAX_DB_CONNECTIONS;
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

      // 5. Bandwidth pressure — SKU network truth beats the generic table
      let bandCap = (SIMULATION_CONSTANTS.BANDWIDTH_CAPACITY_KBPS as Record<string, number>)[type];
      if (sku?.networkGbps) {
        bandCap = sku.networkGbps * SIMULATION_CONSTANTS.KBPS_PER_GBPS;
      }
      if (bandCap && rps > 0) {
        const bandUtil = (rps * payloadKB / bandCap) * 100;
        if (bandUtil > cpu) cpu = bandUtil;
      }
    }

    cpu = Math.min(100, Math.max(0, cpu * jitter()));
    memory = Math.min(100, Math.max(0, memory * jitter()));

    let health: ResourceHealthType = ResourceHealth.HEALTHY;
    if (cpu >= SIMULATION_CONSTANTS.SATURATED_AT || memory >= 97) health = ResourceHealth.SATURATED;
    else if (cpu >= SIMULATION_CONSTANTS.DEGRADED_AT) health = ResourceHealth.DEGRADED;

    const metric: ResourceMetrics = { cpu: round1(cpu), memory: round1(memory), health };
    if (rps > 0) metric.rps = Math.round(rps);
    if (connections !== undefined) metric.connections = connections;
    newMetrics[resourceId] = metric;
  }

  // 6. Threshold-crossing logs
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

  // 7. One-time structural logs — the engine speaks the declared truth
  if (seconds === 1) {
    logs.push({
      timestamp: now,
      severity: "info",
      source: "simulator",
      message: `simulation started — target ${Math.round(state.targetRps)} rps | ${profile.trafficShape === "peak" ? `peak bursts ${profile.peakMultiplier ?? 3}x` : "steady traffic"} | ${Math.round(readFraction * 100)}% reads | ${profile.payloadSize} payloads | ramping over ${SIMULATION_CONSTANTS.RAMP_SECONDS}s`
    });
    for (const id of state.deadEnds) {
      logs.push({
        timestamp: now,
        severity: "warn",
        resourceId: id,
        source: "nginx",
        message: `${id} has no downstream data path — requests requiring data will fail`
      });
    }
  }

  // 8. Overall health
  const healths = Object.values(newMetrics).map(m => m.health);
  let overallHealth: SimulationState["overallHealth"] = "healthy";
  if (healths.includes(ResourceHealth.FAILED)) overallHealth = "critical";
  else if (healths.includes(ResourceHealth.SATURATED)) overallHealth = "saturated";
  else if (healths.includes(ResourceHealth.DEGRADED)) overallHealth = "degraded";

  return {
    state: {
      ...state,
      simulatedSeconds: seconds,
      loadFraction: round1(loadFraction * 100) / 100,
      targetLoadFraction,
      metrics: newMetrics,
      overallHealth
    },
    logs
  };
}