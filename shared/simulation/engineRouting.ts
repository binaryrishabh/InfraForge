/* Full request routing: path-aware inbound RPS by walking the connection
graph from entry points. LBs split to VM backends, caches forward only
misses + writes, DBs forward writes. Pure, zero I/O. */
import { RESOURCE_TYPES } from "../constants/RESOURCE_TYPES.constants";
import { ResourceHealth } from "../enum/ResourceHealth.enum";
import { SIMULATION_CONSTANTS } from "../constants/SIMULATION_CONSTANTS.constants";
import type { SimulationState } from "../interface/SimulationState.interface";

export function computeInboundRps(
    state: SimulationState,
    totalRps: number,
): Record<string, number> {
    const inbound: Record<string, number> = {};
    const entryPoints = state.entryPoints;
    if (entryPoints.length === 0 || totalRps <= 0) return inbound;
    const entryShare = totalRps / entryPoints.length;
    for (const e of entryPoints) inbound[e] = (inbound[e] ?? 0) + entryShare;
    const inDegree: Record<string, number> = {};
    for (const id of Object.keys(state.resourceTypes)) inDegree[id] = 0;
    for (const id of Object.keys(state.resourceTypes)) {
        for (const down of state.downstream[id] ?? []) {
            if (state.resourceTypes[down] !== undefined)
                inDegree[down] = (inDegree[down] ?? 0) + 1;
        }
    }
    for (const e of entryPoints) inDegree[e] = 0;
    const readFraction = state.workloadProfile.readWriteRatio ?? 0.8;
    const writeFraction = 1 - readFraction;
    const queue: string[] = [...entryPoints];
    const processed = new Set<string>();
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (processed.has(id)) continue;
        processed.add(id);
        const rps = inbound[id] ?? 0;
        const type = state.resourceTypes[id];
        const downs = (state.downstream[id] ?? []).filter(
            (d) => state.resourceTypes[d] !== undefined,
        );
        if (rps > 0 && downs.length > 0) {
            if (type === RESOURCE_TYPES.LoadBalancer) {
                const vmBackends = downs.filter(
                    (d) => state.resourceTypes[d] === RESOURCE_TYPES.VirtualMachine,
                );
                if (vmBackends.length > 0) {
                    const share = rps / vmBackends.length;
                    for (const vm of vmBackends) inbound[vm] = (inbound[vm] ?? 0) + share;
                }
            } else if (type === RESOURCE_TYPES.Cache) {
                const isDown = state.metrics[id]?.health === ResourceHealth.FAILED;
                const hitRatio = isDown ? 0 : SIMULATION_CONSTANTS.CACHE_HIT_RATIO;
                const forwardFraction = readFraction * (1 - hitRatio) + writeFraction;
                const share = (rps * forwardFraction) / downs.length;
                for (const d of downs) inbound[d] = (inbound[d] ?? 0) + share;
            } else if (type === RESOURCE_TYPES.Database) {
                const forwarded = rps * writeFraction;
                if (forwarded > 0) {
                    const share = forwarded / downs.length;
                    for (const d of downs) inbound[d] = (inbound[d] ?? 0) + share;
                }
            } else {
                const share = rps / downs.length;
                for (const d of downs) inbound[d] = (inbound[d] ?? 0) + share;
            }
        }
        for (const d of downs) {
            inDegree[d] = (inDegree[d] ?? 0) - 1;
            if (inDegree[d] === 0) queue.push(d);
        }
    }
    return inbound;
}