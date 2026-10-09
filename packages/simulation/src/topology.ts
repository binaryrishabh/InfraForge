/* Graph shape analysis + live-edit reconcile. Pure, zero I/O.
Single source of truth for reachability rules: createInitialState,
reconcileTopology, and the readiness validation all call computeTopology. */
import {
    RESOURCE_TYPES,
    type ResourceType,
} from "@infraforge/domain/resource";
import { ResourceHealth } from "@infraforge/domain/resource";
import { findSku } from "@infraforge/catalog";
import { SIMULATION_CONSTANTS } from "./tuning";
import type { Resource } from "@infraforge/domain/resource";
import type { ConnectionLine } from "@infraforge/domain/resource";
import type { SimulationState } from "./types/SimulationState.interface";
import type { PoolRuntime } from "./types/PoolRuntime.interface";
import type { Sku } from "@infraforge/catalog/types";
import type { ResourceMetrics } from "@infraforge/contracts/telemetry";

import { computeTopology } from "@infraforge/domain/topology";
export { computeTopology, type TopologyAnalysis } from "@infraforge/domain/topology";

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