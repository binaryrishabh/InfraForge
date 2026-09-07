/* Pool snapshots for the wire + the operator's manual scale lever.
Pure decision functions; manual scale reuses the autoscaler machinery. */
import { SIMULATION_CONSTANTS } from "../constants/SIMULATION_CONSTANTS.constants";
import type { SimulationState } from "../interface/SimulationState.interface";
import type { PoolSnapshot } from "../interface/PoolSnapshot.interface";
import type { SpawnedVmInfo } from "../interface/SpawnedVmInfo.interface";
import type { SimulationLog } from "../interface/SimulationLog.interface";

export function buildPoolSnapshots(state: SimulationState): {
    pools: Record<string, PoolSnapshot>;
    spawnedVms: SpawnedVmInfo[];
} {
    const pools: Record<string, PoolSnapshot> = {};
    for (const [lbId, p] of Object.entries(state.pools)) {
        const activeCount =
            p.baseVmIds.length +
            state.spawnedVms.filter((v) => v.poolId === lbId && v.status === "active").length;
        pools[lbId] = {
            lbId,
            baseVmIds: p.baseVmIds,
            currentReplicas: activeCount,
            minReplicas: p.minReplicas,
            maxReplicas: p.maxReplicas,
            targetCpu: p.targetCpu,
            pending: p.pending
                ? { action: p.pending.action, secondsRemaining: p.pending.ticksRemaining }
                : null,
        };
    }
    return { pools, spawnedVms: state.spawnedVms };
}

export function applyManualScale(
    state: SimulationState,
    lbId: string,
    delta: 1 | -1,
): { state: SimulationState; log: SimulationLog } {
    const now = new Date().toISOString();
    const pool = state.pools[lbId];
    if (!pool) {
        return { state, log: { timestamp: now, severity: "warn", source: "operator", message: `no pool found at ${lbId} — manual scale ignored` } };
    }
    if (pool.pending) {
        return { state, log: { timestamp: now, severity: "warn", source: "operator", message: `pool ${lbId} is already scaling — manual command refused` } };
    }
    const spawnedInPool = state.spawnedVms.filter((v) => v.poolId === lbId);
    const totalReplicas = pool.baseVmIds.length + spawnedInPool.length;
    const activeSpawnedCount = spawnedInPool.filter((v) => v.status === "active").length;
    if (delta === 1) {
        if (totalReplicas >= pool.maxReplicas) {
            return { state, log: { timestamp: now, severity: "warn", source: "operator", message: `pool ${lbId} at max replicas (${pool.maxReplicas}) — manual scale-up refused` } };
        }
        const spawnCounter = pool.spawnCounter + 1;
        const newId = `${pool.baseVmIds[0]!}-asg-${spawnCounter}`;
        const ghost: SpawnedVmInfo = {
            id: newId, poolId: lbId,
            x: pool.spawnOrigin.x,
            y: pool.spawnOrigin.y + SIMULATION_CONSTANTS.AUTOSCALING.SPAWN_Y_GAP * spawnCounter,
            status: "provisioning", spawnedAtTick: state.simulatedSeconds,
        };
        return {
            state: {
                ...state,
                spawnedVms: [...state.spawnedVms, ghost],
                pools: {
                    ...state.pools,
                    [lbId]: {
                        ...pool, spawnCounter,
                        pending: { action: "up", ticksRemaining: SIMULATION_CONSTANTS.AUTOSCALING.PROVISION_TICKS },
                    },
                },
            },
            log: { timestamp: now, severity: "info", source: "operator", message: `manual scale-up on ${lbId} — provisioning replica ${totalReplicas + 1} (${SIMULATION_CONSTANTS.AUTOSCALING.PROVISION_TICKS}s)` },
        };
    }
    if (activeSpawnedCount === 0 || totalReplicas <= pool.minReplicas) {
        return { state, log: { timestamp: now, severity: "warn", source: "operator", message: `pool ${lbId} has no scalable replicas — base replicas are protected` } };
    }
    return {
        state: {
            ...state,
            pools: {
                ...state.pools,
                [lbId]: { ...pool, pending: { action: "down", ticksRemaining: SIMULATION_CONSTANTS.AUTOSCALING.DRAIN_TICKS } },
            },
        },
        log: { timestamp: now, severity: "info", source: "operator", message: `manual scale-down on ${lbId} — draining one replica` },
    };
}