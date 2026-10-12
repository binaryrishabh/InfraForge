import type { Resource, ConnectionLine } from "@infraforge/domain/resource";
import type { ReportTopology, RunReport } from "@infraforge/contracts/reports";

type Topology = { resources: Resource[]; connectionLines: ConnectionLine[] };
export function topologySummary(value: Topology | null): ReportTopology | null {
  return value && { resources: value.resources.map((r) => ({ id: r.id, name: r.name || r.id, type: r.type,
    ...(r.skuId ? { skuId: r.skuId } : {}) })), connectionCount: value.connectionLines.length };
}

function configuration(r: Resource) {
  return JSON.stringify([r.type, r.skuId ?? null, r.size ?? null, r.region ?? null,
    r.public ?? null, r.encryption ?? null, [...r.openPorts ?? []].sort((a, b) => a - b),
    r.autoscaling?.enabled ?? null, r.autoscaling?.minReplicas ?? null,
    r.autoscaling?.maxReplicas ?? null, r.autoscaling?.targetCpu ?? null]);
}

export function topologyChanges(original: Topology | null, live: Topology | null): RunReport["topology"]["changes"] {
  if (!original || !live) return null;
  const before = new Map(original.resources.map((r) => [r.id, r]));
  const after = new Map(live.resources.map((r) => [r.id, r]));
  const connections = (value: Topology) => new Set(value.connectionLines.map((c) => JSON.stringify([c.sourceId, c.targetId, c.port])));
  const oldConnections = connections(original), newConnections = connections(live);
  // Duplicate identifiers/edges make a by-ID comparison ambiguous. Keep the
  // recorded inputs visible, but do not infer edits from those records.
  if (before.size !== original.resources.length || after.size !== live.resources.length ||
      oldConnections.size !== original.connectionLines.length || newConnections.size !== live.connectionLines.length) return null;
  return { added: [...after.keys()].filter((id) => !before.has(id)).sort(),
    removed: [...before.keys()].filter((id) => !after.has(id)).sort(),
    reconfigured: [...after].filter(([id, r]) => before.has(id) && configuration(r) !== configuration(before.get(id)!)).map(([id]) => id).sort(),
    addedConnections: [...newConnections].filter((c) => !oldConnections.has(c)).length,
    removedConnections: [...oldConnections].filter((c) => !newConnections.has(c)).length };
}
