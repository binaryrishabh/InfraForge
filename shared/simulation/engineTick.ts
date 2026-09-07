/* The heart: one deterministic simulation second. Pure, zero I/O.
Loads, routes, cascades, retry storms, chaos, autoscaling, vertical scaling. */
import { RESOURCE_TYPES } from "../constants/RESOURCE_TYPES.constants";
import { ResourceHealth, type ResourceHealthType } from "../enum/ResourceHealth.enum";
import { findSku } from "../catalog/index";
import { SIMULATION_CONSTANTS } from "../constants/SIMULATION_CONSTANTS.constants";
import { CAPACITY } from "../constants/CAPACITY.constants";
import { mulberry32, round1, burstFactor, chaosApplyMessage, failureVoice } from "./engineHelpers";
import { computeInboundRps } from "./engineRouting";
import type { TickResult } from "../interface/TickResult.interface";
import type { TickInputs } from "../interface/TickInputs.interface";
import type { SimulationState } from "../interface/SimulationState.interface";
import type { ChaosEffect } from "../interface/ChaosEffect.interface";
import type { PoolRuntime } from "../interface/PoolRuntime.interface";
import type { SpawnedVmInfo } from "../interface/SpawnedVmInfo.interface";
import type { VerticalScaleAction } from "../interface/VerticalScaleAction.interface";
import type { ResourceMetrics } from "../interface/ResourceMetrics.interface";
import type { SimulationLog } from "../interface/SimulationLog.interface";

export function tick(state: SimulationState, inputs: TickInputs): TickResult {
    const logs: SimulationLog[] = [];
    const seconds = state.simulatedSeconds + 1;
    const now = new Date().toISOString();
    const profile = state.workloadProfile;
    // 1. Slider-driven load target
    let targetLoadFraction = inputs.targetLoadFraction ?? state.targetLoadFraction;
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
                timestamp: now, severity: "warn", source: "load-generator",
                message: `traffic burst beginning — ${peak}x declared base load`,
            });
        } else if (burstPrev > 1.01 && burstNow <= 1.01) {
            logs.push({
                timestamp: now, severity: "info", source: "load-generator",
                message: "burst subsided — traffic returning to base level",
            });
        }
    }
    // 3. Workload mix
    const readFraction = profile.readWriteRatio ?? 0.8;
    const writeFraction = 1 - readFraction;
    const payloadKB = SIMULATION_CONSTANTS.PAYLOAD_KB[profile.payloadSize];
    const rng = mulberry32(state.seed * 100003 + seconds);
    const jitter = () => 1 + (rng() - 0.5) * 0.06;
    // 4. Index active chaos and vertical scaling
    const chaosByResource: Record<string, ChaosEffect[]> = {};
    for (const effect of state.activeChaos)
        (chaosByResource[effect.resourceId] ??= []).push(effect);
    const downResources = new Set(
        state.activeChaos.filter((e) => e.chaosType === "crash").map((e) => e.resourceId),
    );
    const restartingResources = new Set(state.verticalScaling.map((v) => v.resourceId));
    // 4c. CASCADE — previous tick's health so failure walks one hop per tick
    const failedSet = new Set<string>();
    const saturatedSet = new Set<string>();
    const degradedSet = new Set<string>();
    for (const [rid, m] of Object.entries(state.metrics)) {
        if (m.health === ResourceHealth.FAILED) failedSet.add(rid);
        else if (m.health === ResourceHealth.SATURATED) saturatedSet.add(rid);
        else if (m.health === ResourceHealth.DEGRADED) degradedSet.add(rid);
    }
    const cascadeStress: Record<string, number> = {};
    const retryBoost: Record<string, number> = {};
    for (const resourceId of Object.keys(state.resourceTypes)) {
        let stress = 0;
        const downs = state.downstream[resourceId] ?? [];
        for (const d of downs) {
            if (failedSet.has(d)) stress += 0.5;
            else if (saturatedSet.has(d)) stress += 0.2;
        }
        cascadeStress[resourceId] = Math.min(1, stress);
        let boost = 0;
        const ups = state.upstream[resourceId] ?? [];
        for (const u of ups) {
            if (failedSet.has(u) || saturatedSet.has(u) || degradedSet.has(u)) {
                boost += SIMULATION_CONSTANTS.CASCADE.RETRY_AMPLIFICATION;
            }
        }
        retryBoost[resourceId] = Math.min(SIMULATION_CONSTANTS.CASCADE.MAX_RETRY_BOOST, boost);
    }
    // 4d. FULL REQUEST ROUTING + pool re-split across serving replicas
    const inbound = computeInboundRps(state, totalRps);
    for (const [lbId, pool] of Object.entries(state.pools)) {
        const lbInbound = inbound[lbId] ?? 0;
        const servingPoolVms = [
            ...pool.baseVmIds,
            ...state.spawnedVms.filter((v) => v.poolId === lbId && v.status === "active").map((v) => v.id),
        ].filter((id) => !downResources.has(id) && !restartingResources.has(id));
        if (servingPoolVms.length > 0 && lbInbound > 0) {
            const perVm = lbInbound / servingPoolVms.length;
            for (const vmId of servingPoolVms) inbound[vmId] = perVm;
        }
    }
    // 5. Distribute load — exclude crashed AND restarting resources
    const reachableSet = new Set(state.reachable);
    const activeSpawned = state.spawnedVms.filter((v) => v.status === "active");
    const activeSpawnedIds = new Set(activeSpawned.map((v) => v.id));
    const vmIds = [
        ...state.reachable.filter((id) => state.resourceTypes[id] === RESOURCE_TYPES.VirtualMachine),
        ...activeSpawned.map((v) => v.id),
    ].filter((id) => !downResources.has(id) && !restartingResources.has(id));
    const newMetrics: Record<string, ResourceMetrics> = {};
    for (const resourceId of Object.keys(state.resourceTypes)) {
        const type = state.resourceTypes[resourceId];
        if (!type) continue;
        const capacity = CAPACITY[type];
        const sku = state.resourceSkus[resourceId];
        let cpu = 0, memory = 0, rps = 0;
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
                    rps = inbound[resourceId] ?? 0;
                    const vmCapacity = sku
                        ? sku.vCpu * sku.baselineFactor * SIMULATION_CONSTANTS.RPS_PER_VCPU
                        : capacity.rps;
                    cpu = (rps / vmCapacity) * 100 *
                        (1 + writeFraction * SIMULATION_CONSTANTS.VM_WRITE_CPU_TAX);
                    memory = 25 + cpu * 0.5;
                    connections = Math.ceil(rps / 10);
                    break;
                }
                case RESOURCE_TYPES.Database: {
                    // STAMPEDE — feeding cache down collapses hit ratio onto this DB
                    const ups = state.upstream[resourceId] ?? [];
                    const feedingCaches = ups.filter(
                        (id) => state.resourceTypes[id] === RESOURCE_TYPES.Cache,
                    );
                    const cacheDown = feedingCaches.some((id) => failedSet.has(id));
                    const effectiveHitRatio =
                        feedingCaches.length > 0 && !cacheDown
                            ? SIMULATION_CONSTANTS.CACHE_HIT_RATIO
                            : 0;
                    const dbLoadFactorLocal =
                        readFraction * (1 - effectiveHitRatio) +
                        writeFraction * SIMULATION_CONSTANTS.WRITE_COST_FACTOR;
                    rps = totalRps * dbLoadFactorLocal;
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
                    rps = inbound[resourceId] ?? 0;
                    cpu = (rps / capacity.rps) * 100;
                    memory = 20 + cpu * 0.3;
                }
            }
            let bandCap = (
                SIMULATION_CONSTANTS.BANDWIDTH_CAPACITY_KBPS as Record<string, number>
            )[type];
            if (sku?.networkGbps) bandCap = sku.networkGbps * SIMULATION_CONSTANTS.KBPS_PER_GBPS;
            if (bandCap && rps > 0) {
                const bandUtil = ((rps * payloadKB) / bandCap) * 100;
                if (bandUtil > cpu) cpu = bandUtil;
            }
            const stress = cascadeStress[resourceId] ?? 0;
            if (stress > 0) cpu = cpu * (1 + stress);
            const retries = retryBoost[resourceId] ?? 0;
            if (retries > 0) cpu = cpu * (1 + retries);
        }
        // 6. Apply chaos effects
        const effects = chaosByResource[resourceId];
        let crashed = false;
        if (effects) {
            for (const effect of effects) {
                switch (effect.chaosType) {
                    case "crash": crashed = true; break;
                    case "cpu-spike": cpu += SIMULATION_CONSTANTS.CHAOS.CPU_SPIKE_BOOST; break;
                    case "memory-leak": {
                        const elapsed = effect.durationTicks - effect.remainingTicks;
                        memory += elapsed * SIMULATION_CONSTANTS.CHAOS.MEMORY_LEAK_RATE;
                        break;
                    }
                    case "network-delay": cpu = cpu * SIMULATION_CONSTANTS.CHAOS.NETWORK_DELAY_CPU_FACTOR; break;
                    case "disk-failure": cpu = 100; break;
                }
            }
        }
        if (crashed) { cpu = 0; memory = 0; rps = 0; connections = undefined; }
        const isRestarting = restartingResources.has(resourceId);
        if (isRestarting) { cpu = 0; memory = 0; rps = 0; connections = undefined; }
        cpu = Math.min(100, Math.max(0, cpu * jitter()));
        memory = Math.min(100, Math.max(0, memory * jitter()));
        let health: ResourceHealthType;
        if (crashed) health = ResourceHealth.FAILED;
        else if (isRestarting) health = ResourceHealth.FAILED;
        else if (cpu >= SIMULATION_CONSTANTS.SATURATED_AT || memory >= 97)
            health = ResourceHealth.SATURATED;
        else if (cpu >= SIMULATION_CONSTANTS.DEGRADED_AT) health = ResourceHealth.DEGRADED;
        else health = ResourceHealth.HEALTHY;
        const metric: ResourceMetrics = { cpu: round1(cpu), memory: round1(memory), health };
        if (rps > 0) metric.rps = Math.round(rps);
        if (connections !== undefined) metric.connections = connections;
        newMetrics[resourceId] = metric;
    }
    // 5e. DEAD-END REQUEST FAILURE
    if (seconds % 10 === 0) {
        for (const deadId of state.deadEnds) {
            if ((inbound[deadId] ?? 0) > 0 && !downResources.has(deadId) && !restartingResources.has(deadId)) {
                logs.push({ timestamp: now, severity: "error", resourceId: deadId, source: "app", message: `${deadId} dropping data requests — no downstream data path, returning 500s` });
            }
        }
    }
    // 6c. CASCADE — LB sheds 502s when backends are unhealthy
    const nextSheddingLbs: string[] = [];
    for (const resourceId of Object.keys(state.resourceTypes)) {
        if (state.resourceTypes[resourceId] !== RESOURCE_TYPES.LoadBalancer) continue;
        const downs = state.downstream[resourceId] ?? [];
        const backendVms = downs.filter((id) => state.resourceTypes[id] === RESOURCE_TYPES.VirtualMachine);
        const unhealthyBackends = backendVms.filter((id) => failedSet.has(id) || saturatedSet.has(id));
        if (unhealthyBackends.length > 0) {
            nextSheddingLbs.push(resourceId);
            if (!state.sheddingLbs.includes(resourceId)) {
                logs.push({ timestamp: now, severity: "error", resourceId, source: "nginx", message: `${resourceId} shedding 502s — ${unhealthyBackends.length} backend(s) unhealthy (${unhealthyBackends.join(", ")})` });
            }
        }
    }
    for (const lbId of state.sheddingLbs) {
        if (!nextSheddingLbs.includes(lbId)) {
            logs.push({ timestamp: now, severity: "info", resourceId: lbId, source: "nginx", message: `${lbId} recovered — backends healthy, 502s stopped` });
        }
    }
    // 7. Chaos lifecycle
    const nextActiveChaos: ChaosEffect[] = [];
    for (const effect of state.activeChaos) {
        const isFirstTick = effect.remainingTicks === effect.durationTicks;
        if (isFirstTick)
            logs.push({ timestamp: now, severity: "error", resourceId: effect.resourceId, source: "chaos", message: chaosApplyMessage(effect) });
        const remaining = effect.remainingTicks - 1;
        if (remaining <= 0)
            logs.push({ timestamp: now, severity: "info", resourceId: effect.resourceId, source: "chaos", message: `${effect.resourceId} recovered from ${effect.chaosType}` });
        else nextActiveChaos.push({ ...effect, remainingTicks: remaining });
    }
    // 8. Autoscaler
    let nextSpawnedVms: SpawnedVmInfo[] = state.spawnedVms.map((v) => ({ ...v }));
    let nextResourceTypes = state.resourceTypes;
    let nextResourceSkus = state.resourceSkus;
    const nextPools: Record<string, PoolRuntime> = {};
    for (const [lbId, pool] of Object.entries(state.pools)) {
        const p: PoolRuntime = { ...pool, pending: pool.pending ? { ...pool.pending } : null };
        const alivePoolVmIds = [
            ...p.baseVmIds,
            ...nextSpawnedVms.filter((v) => v.poolId === lbId && v.status === "active").map((v) => v.id),
        ].filter((id) => !downResources.has(id) && !restartingResources.has(id));
        const cpus = alivePoolVmIds.map((id) => newMetrics[id]?.cpu ?? 0);
        const avgCpu = cpus.length > 0 ? cpus.reduce((a, b) => a + b, 0) / cpus.length : 0;
        const totalReplicas =
            p.baseVmIds.length + nextSpawnedVms.filter((v) => v.poolId === lbId).length;
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
                            logs.push({ timestamp: now, severity: "info", resourceId: v.id, source: "autoscaler", message: `${v.id} joined pool ${lbId} — traffic redistributing` });
                        }
                    }
                } else {
                    const activeInPool = nextSpawnedVms.filter((v) => v.poolId === lbId && v.status === "active");
                    const victim = activeInPool[activeInPool.length - 1];
                    if (victim) {
                        nextSpawnedVms = nextSpawnedVms.filter((v) => v.id !== victim.id);
                        if (nextResourceTypes[victim.id]) {
                            nextResourceTypes = { ...nextResourceTypes };
                            delete nextResourceTypes[victim.id];
                            nextResourceSkus = { ...nextResourceSkus };
                            delete nextResourceSkus[victim.id];
                        }
                        logs.push({ timestamp: now, severity: "info", resourceId: victim.id, source: "autoscaler", message: `${victim.id} drained and removed — pool ${lbId} back to ${totalReplicas - 1} replicas` });
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
                    p.pending = { action: "up", ticksRemaining: SIMULATION_CONSTANTS.AUTOSCALING.PROVISION_TICKS };
                    p.spawnCounter += 1;
                    const newId = `${p.baseVmIds[0]!}-asg-${p.spawnCounter}`;
                    nextSpawnedVms = [...nextSpawnedVms, {
                        id: newId, poolId: lbId,
                        x: p.spawnOrigin.x,
                        y: p.spawnOrigin.y + SIMULATION_CONSTANTS.AUTOSCALING.SPAWN_Y_GAP * p.spawnCounter,
                        status: "provisioning", spawnedAtTick: seconds,
                    }];
                    logs.push({ timestamp: now, severity: "warn", source: "autoscaler", message: `pool ${lbId} avg cpu ${round1(avgCpu)}% above target ${p.targetCpu}% — provisioning new instance (${SIMULATION_CONSTANTS.AUTOSCALING.PROVISION_TICKS}s)` });
                } else {
                    p.hotTicks = SIMULATION_CONSTANTS.AUTOSCALING.HOT_TICKS;
                }
            }
        } else if (avgCpu < SIMULATION_CONSTANTS.AUTOSCALING.SCALE_DOWN_AT) {
            p.coldTicks += 1;
            p.hotTicks = 0;
            const activeSpawnedCount = nextSpawnedVms.filter((v) => v.poolId === lbId && v.status === "active").length;
            if (p.coldTicks >= SIMULATION_CONSTANTS.AUTOSCALING.COLD_TICKS && activeSpawnedCount > 0 && totalReplicas > p.minReplicas) {
                p.coldTicks = 0;
                p.pending = { action: "down", ticksRemaining: SIMULATION_CONSTANTS.AUTOSCALING.DRAIN_TICKS };
                logs.push({ timestamp: now, severity: "info", source: "autoscaler", message: `pool ${lbId} running cold at ${round1(avgCpu)}% — draining one instance` });
            }
        } else {
            p.hotTicks = 0;
            p.coldTicks = 0;
        }
        nextPools[lbId] = p;
    }
    // 8b. Vertical scaling lifecycle
    const nextVerticalScaling: VerticalScaleAction[] = [];
    for (const action of state.verticalScaling) {
        const isFirstTick = action.remainingTicks === action.downtimeTicks;
        if (isFirstTick) {
            logs.push({ timestamp: now, severity: "warn", resourceId: action.resourceId, source: "autoscaler", message: `${action.resourceId} scaling vertically to ${action.toSkuId} — restarting (${action.downtimeTicks}s downtime)` });
        }
        const remaining = action.remainingTicks - 1;
        if (remaining <= 0) {
            nextResourceSkus = { ...nextResourceSkus };
            const newSku = findSku(action.toSkuId);
            if (newSku) nextResourceSkus[action.resourceId] = newSku;
            logs.push({ timestamp: now, severity: "info", resourceId: action.resourceId, source: "autoscaler", message: `${action.resourceId} back online at ${action.toSkuId}` });
        } else {
            nextVerticalScaling.push({ ...action, remainingTicks: remaining });
        }
    }
    // 9. Threshold-crossing logs with cascade culprit named
    for (const [resourceId, metric] of Object.entries(newMetrics)) {
        const before = state.metrics[resourceId]?.health ?? ResourceHealth.HEALTHY;
        const after = metric.health;
        if (before === after) continue;
        const type = state.resourceTypes[resourceId];
        const source = type ? CAPACITY[type].source : "app";
        const downs = state.downstream[resourceId] ?? [];
        const culprit = downs.find((d) => failedSet.has(d) || saturatedSet.has(d));
        let severity: "info" | "warn" | "error" = "info";
        let message = `utilization recovered on ${resourceId} — cpu ${metric.cpu}%`;
        if (after === ResourceHealth.DEGRADED) {
            severity = "warn";
            message = culprit
                ? `${resourceId} degrading — downstream ${culprit} is ${failedSet.has(culprit) ? "down" : "saturated"}`
                : `cpu at ${metric.cpu}% on ${resourceId} — approaching saturation`;
        } else if (after === ResourceHealth.SATURATED) {
            severity = "error";
            const voice = failureVoice(type, after, metric);
            message = culprit
                ? `${resourceId} saturated — downstream ${culprit} is ${failedSet.has(culprit) ? "down" : "saturated"}; ${voice}`
                : `${resourceId} ${voice}`;
        } else if (after === ResourceHealth.FAILED) {
            severity = "error";
            message = `${resourceId} ${failureVoice(type, after, metric)}`;
        }
        logs.push({ timestamp: now, severity, resourceId, source, message });
    }
    // 10. One-time structural logs
    if (seconds === 1) {
        logs.push({ timestamp: now, severity: "info", source: "simulator", message: `simulation started — target ${Math.round(state.targetRps)} rps | ${profile.trafficShape === "peak" ? `peak bursts ${profile.peakMultiplier ?? 3}x` : "steady traffic"} | ${Math.round(readFraction * 100)}% reads | ${profile.payloadSize} payloads | ramping over ${SIMULATION_CONSTANTS.RAMP_SECONDS}s` });
        for (const [lbId, pool] of Object.entries(nextPools)) {
            logs.push({ timestamp: now, severity: "info", source: "autoscaler", message: `pool ${lbId} formed — ${pool.baseVmIds.length} base replicas, autoscale ${pool.minReplicas}-${pool.maxReplicas} at ${pool.targetCpu}% target` });
        }
        for (const id of state.deadEnds) {
            logs.push({ timestamp: now, severity: "warn", resourceId: id, source: "nginx", message: `${id} has no downstream data path — requests requiring data will fail` });
        }
    }
    // 11. Overall health
    const healths = Object.values(newMetrics).map((m) => m.health);
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
            resourceTypes: nextResourceTypes,
            resourceSkus: nextResourceSkus,
            metrics: newMetrics,
            overallHealth,
            activeChaos: nextActiveChaos,
            pools: nextPools,
            spawnedVms: nextSpawnedVms,
            verticalScaling: nextVerticalScaling,
            sheddingLbs: nextSheddingLbs,
        },
        logs,
    };
}