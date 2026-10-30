import type { Resource, ConnectionLine } from "@infraforge/domain/resource";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import type { DesignDifference, FieldDifference } from "@infraforge/contracts/reports";

// Stable keys, but never sort arrays implicitly: resource position has model-1 meaning.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function fields(before: Record<string, unknown>, after: Record<string, unknown>): FieldDifference[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((field) =>
    canonical(before[field]) === canonical(after[field]) ? [] : [{ field, earlier: before[field] ?? null, later: after[field] ?? null }]);
}
export function configuration(r: Resource): Record<string, unknown> {
  return { ...(r.listenerSettings === undefined ? {} : { listenerSettings: r.listenerSettings }), ...(r.firewallSettings === undefined ? {} : { firewallSettings: r.firewallSettings }), ...(r.applicationFlow === undefined ? {} : { applicationFlow: r.applicationFlow }), ...(r.asyncQueue === undefined ? {} : { asyncQueue: r.asyncQueue }), ...(r.asyncWorker === undefined ? {} : { asyncWorker: r.asyncWorker }), ...(r.circuitBreaker === undefined ? {} : { circuitBreaker: r.circuitBreaker }), ...(r.retry === undefined ? {} : { retry: r.retry }), type: r.type, skuId: r.skuId ?? null, size: r.size ?? null, region: r.region ?? null,
    public: r.public ?? null, encryption: r.encryption ?? null, openPorts: [...r.openPorts ?? []].sort((a, b) => a - b),
    "autoscaling.enabled": r.autoscaling?.enabled ?? null, "autoscaling.minReplicas": r.autoscaling?.minReplicas ?? null,
    "autoscaling.maxReplicas": r.autoscaling?.maxReplicas ?? null, "autoscaling.targetCpu": r.autoscaling?.targetCpu ?? null };
}
const flowBound = (topology: RunTopology) => topology.resources.some(r => r.applicationFlow !== undefined);
const edge = (c: ConnectionLine, includeId = false) => ({ ...(includeId ? { id: c.id } : {}), sourceId: c.sourceId, targetId: c.targetId, port: c.port });
export function normalizedTopology(topology: RunTopology) {
  return { resources: topology.resources.map((r) => ({ id: r.id, ...configuration(r) })).sort((a, b) => a.id.localeCompare(b.id)),
    // Connection order is kept as captured: Model 1 runs used it for routing and pool templates.
    connections: topology.connectionLines.map(c => edge(c, flowBound(topology))) };
}
export function unambiguous(topology: RunTopology) {
  return topology.resources.length <= 500 && topology.connectionLines.length <= 1000 &&
    new Set(topology.resources.map((r) => r.id)).size === topology.resources.length &&
    new Set(topology.connectionLines.map((c) => canonical(edge(c)))).size === topology.connectionLines.length &&
    (!flowBound(topology) || new Set(topology.connectionLines.map(c => c.id)).size === topology.connectionLines.length);
}
export function designDifference(before: RunTopology, after: RunTopology): DesignDifference {
  const a = new Map(before.resources.map((r) => [r.id, r]));
  const b = new Map(after.resources.map((r) => [r.id, r]));
  // Use the same projection for identity, additions/removals and authored order.
  const includeId = flowBound(before) || flowBound(after);
  const beforeEdges = before.connectionLines.map(c => edge(c, includeId)), afterEdges = after.connectionLines.map(c => edge(c, includeId));
  const ae = new Map(beforeEdges.map(c => [canonical(c), c]));
  const be = new Map(afterEdges.map(c => [canonical(c), c]));
  const orderA = before.resources.map((r) => r.id), orderB = after.resources.map((r) => r.id);
  return { added: [...b.keys()].filter((id) => !a.has(id)).sort(), removed: [...a.keys()].filter((id) => !b.has(id)).sort(),
    reconfigured: [...b].filter(([id]) => a.has(id)).sort(([x], [y]) => x.localeCompare(y)).flatMap(([id, r]) => {
      const changed = fields(configuration(a.get(id)!), configuration(r)); return changed.length ? [{ id, fields: changed }] : [];
    }), addedConnections: [...be].filter(([k]) => !ae.has(k)).sort(([x], [y]) => x.localeCompare(y)).map(([, v]) => v),
    removedConnections: [...ae].filter(([k]) => !be.has(k)).sort(([x], [y]) => x.localeCompare(y)).map(([, v]) => v),
    resourceOrder: canonical(orderA) === canonical(orderB) ? null : { earlier: orderA, later: orderB },
    connectionOrder: canonical(beforeEdges) === canonical(afterEdges) ? null :
      { earlier: beforeEdges, later: afterEdges } };
}
