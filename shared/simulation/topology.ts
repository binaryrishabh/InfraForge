/* Graph shape analysis + live-edit reconcile. Pure, zero I/O.
Single source of truth for reachability rules: createInitialState,
reconcileTopology, and the readiness validation all call computeTopology. */
import {
    RESOURCE_TYPES,
    type ResourceType,
} from "../constants/RESOURCE_TYPES.constants";
import { ResourceHealth } from "../enum/ResourceHealth.enum";
import { findSku } from "../catalog/index";
import { SIMULATION_CONSTANTS } from "../constants/SIMULATION_CONSTANTS.constants";
import type { Resource } from "../interface/Resource.interface";
import type { ConnectionLine } from "../interface/ConnectionLine.interface";
import type { SimulationState } from "../interface/SimulationState.interface";
import type { PoolRuntime } from "../interface/PoolRuntime.interface";
import type { Sku } from "../catalog/catalog.types";
import type { ResourceMetrics } from "../interface/ResourceMetrics.interface";

export interface TopologyAnalysis {
    adjacency: Record<string, string[]>;
    upstream: Record<string, string[]>;
    entryPoints: string[];
    reachable: string[];
    deadEnds: string[];
    idle: string[];
}

export function computeTopology(
    resources: Resource[],
    connectionLines: ConnectionLine[],
): TopologyAnalysis {
    const adjacency: Record<string, string[]> = {};
    for (const c of connectionLines) {
        (adjacency[c.sourceId] ??= []).push(c.targetId);
    }
    const upstream: Record<string, string[]> = {};
    for (const c of connectionLines) {
        (upstream[c.targetId] ??= []).push(c.sourceId);
    }
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
    const reachableSet = new Set<string>();
    const queue = [...entryPoints];
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (reachableSet.has(id)) continue;
        reachableSet.add(id);
        for (const next of adjacency[id] ?? []) queue.push(next);
    }
    const deadEnds = resources
        .filter(
            (r) =>
                r.type === RESOURCE_TYPES.VirtualMachine &&
                reachableSet.has(r.id) &&
                (adjacency[r.id] ?? []).length === 0,
        )
        .map((r) => r.id);
    const idle = resources.filter((r) => !reachableSet.has(r.id)).map((r) => r.id);
    return { adjacency, upstream, entryPoints, reachable: [...reachableSet], deadEnds, idle };
}

/* LIVE-EDIT RECONCILE — rebuilds topology from the current canvas while
preserving runtime state: metrics, chaos, vertical scales, spawned replicas,
pool warmth. This is what makes editing a RUNNING simulation safe. */
export function reconcileTopology(
    state: SimulationState,
    resources: Resource[],
    connectionLines: ConnectionLine[],
): SimulationState {
    const topology = computeTopology(resources, connectionLines);
    const liveIds = new Set(resources.map((r) => r.id));
    const resourceTypes: Record<string, ResourceType> = {};
    const resourceSkus: Record<string, Sku> = {};
    const metrics: Record<string, ResourceMetrics> = {};
    for (const r of resources) {
        resourceTypes[r.id] = r.type;
        const declared = r.skuId ? findSku(r.skuId) : undefined;
        const sku = declared ?? state.resourceSkus[r.id];
        if (sku) resourceSkus[r.id] = sku;
        metrics[r.id] =
            state.metrics[r.id] ??
            { cpu: 0, memory: 0, health: ResourceHealth.HEALTHY };
    }
    const pools: Record<string, PoolRuntime> = {};
    for (const lb of resources) {
        if (lb.type !== RESOURCE_TYPES.LoadBalancer) continue;
        const baseVmIds = (topology.adjacency[lb.id] ?? []).filter(
            (id) => resourceTypes[id] === RESOURCE_TYPES.VirtualMachine,
        );
        if (baseVmIds.length === 0) continue;
        const policy = lb.autoscaling;
        if (policy?.enabled === false) continue;
        const previous = state.pools[lb.id];
        const base = baseVmIds.length;
        const minReplicas = policy?.minReplicas ?? previous?.minReplicas ?? base;
        const maxReplicas = Math.max(
            minReplicas,
            Math.min(
                policy?.maxReplicas ??
                    previous?.maxReplicas ??
                    base * SIMULATION_CONSTANTS.AUTOSCALING.DEFAULT_MAX_MULTIPLIER,
                SIMULATION_CONSTANTS.AUTOSCALING.DEFAULT_MAX_CAP,
            ),
        );
        const basePositions = baseVmIds
            .map((id) => resources.find((r) => r.id === id))
            .filter((r): r is Resource => Boolean(r));
        pools[lb.id] = {
            lbId: lb.id,
            baseVmIds,
            minReplicas,
            maxReplicas,
            targetCpu:
                policy?.targetCpu ??
                previous?.targetCpu ??
                SIMULATION_CONSTANTS.AUTOSCALING.DEFAULT_TARGET_CPU,
            hotTicks: previous?.hotTicks ?? 0,
            coldTicks: previous?.coldTicks ?? 0,
            spawnCounter: previous?.spawnCounter ?? 0,
            spawnOrigin: {
                x: basePositions[0]?.x ?? 200,
                y: Math.max(...basePositions.map((r) => r.y), 0),
            },
            pending: previous?.pending ?? null,
        };
    }
    // Already-spawned replicas survive only while their pool still exists.
    const keptSpawnedVms = state.spawnedVms.filter(
        (v) => pools[v.poolId] !== undefined,
    );
    for (const vm of keptSpawnedVms) {
        if (vm.status !== "active") continue;
        resourceTypes[vm.id] = RESOURCE_TYPES.VirtualMachine;
        const carried = state.resourceSkus[vm.id];
        if (carried) resourceSkus[vm.id] = carried;
        metrics[vm.id] =
            state.metrics[vm.id] ??
            { cpu: 0, memory: 0, health: ResourceHealth.HEALTHY };
    }
    return {
        ...state,
        resourceTypes,
        resourceSkus,
        metrics,
        entryPoints: topology.entryPoints,
        reachable: topology.reachable,
        deadEnds: topology.deadEnds,
        idle: topology.idle,
        downstream: topology.adjacency,
        upstream: topology.upstream,
        pools,
        spawnedVms: keptSpawnedVms,
        activeChaos: state.activeChaos.filter((e) => liveIds.has(e.resourceId)),
        verticalScaling: state.verticalScaling.filter((v) => liveIds.has(v.resourceId)),
        sheddingLbs: state.sheddingLbs.filter((id) => pools[id] !== undefined),
    };
}