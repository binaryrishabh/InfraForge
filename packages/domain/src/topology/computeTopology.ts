import { RESOURCE_TYPES, type ResourceType } from "../resource/RESOURCE_TYPES.constants";
import type { Resource } from "../resource/Resource.interface";
import type { ConnectionLine } from "../resource/ConnectionLine.interface";

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
