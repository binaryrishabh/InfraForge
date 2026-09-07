/* Builds the initial simulation state. Topology comes from computeTopology
(topology.ts) — one source of truth for reachability rules. Pure, zero I/O. */
import { RESOURCE_TYPES, type ResourceType } from "../constants/RESOURCE_TYPES.constants";
import { ResourceHealth } from "../enum/ResourceHealth.enum";
import { findSku } from "../catalog/index";
import { SIMULATION_CONSTANTS } from "../constants/SIMULATION_CONSTANTS.constants";
import { computeTopology } from "./topology";
import type { Resource } from "../interface/Resource.interface";
import type { ConnectionLine } from "../interface/ConnectionLine.interface";
import type { WorkloadProfile } from "../interface/WorkloadProfile.interface";
import type { SimulationState } from "../interface/SimulationState.interface";
import type { PoolRuntime } from "../interface/PoolRuntime.interface";
import type { Sku } from "../catalog/catalog.types";
import type { ResourceMetrics } from "../interface/ResourceMetrics.interface";

export function createInitialState(
    deploymentId: string,
    resources: Resource[],
    connectionLines: ConnectionLine[],
    workloadProfile: WorkloadProfile,
    seed: number,
): SimulationState {
    const topology = computeTopology(resources, connectionLines);
    const entryPoints = topology.entryPoints;
    const adjacency = topology.adjacency;
    const upstream = topology.upstream;
    const reachable = new Set(topology.reachable);
    const deadEnds = topology.deadEnds;
    const idle = topology.idle;
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
                policy?.targetCpu ?? SIMULATION_CONSTANTS.AUTOSCALING.DEFAULT_TARGET_CPU,
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
        downstream: adjacency,
        upstream,
        sheddingLbs: [],
    };
}