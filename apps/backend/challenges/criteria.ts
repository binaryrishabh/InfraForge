import { findSku } from "@infraforge/catalog";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import type { ConnectionLine, Resource } from "@infraforge/domain/resource";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";

/* Deterministic checks shared by preflight and evaluation. Each returns a plain
fact; nothing here infers why a measurement happened. */

export interface Topology { resources: Resource[]; connectionLines: ConnectionLine[] }

export function appServersBehindBalancer(topology: Topology) {
  const types = new Map(topology.resources.map((r) => [r.id, r.type]));
  return new Set(topology.connectionLines.filter((line) => types.get(line.sourceId) === RESOURCE_TYPES.LoadBalancer &&
    types.get(line.targetId) === RESOURCE_TYPES.VirtualMachine).map((line) => line.targetId)).size;
}

export function genericSized(topology: Topology) {
  return topology.resources.filter((r) => (r.type === RESOURCE_TYPES.VirtualMachine || r.type === RESOURCE_TYPES.Database) &&
    !(r.skuId && findSku(r.skuId))).map((r) => r.id);
}

export const label = (r: Resource) => r.name?.trim() ? `${r.name.trim()} (${r.id})` : r.id;
export const list = (items: string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const HEALTH_ORDER = ["healthy", "degraded", "saturated", "failed"] as const;
export function worstHealth(values: Array<string | undefined>) {
  let worst = -1;
  for (const value of values) worst = Math.max(worst, HEALTH_ORDER.indexOf(value as never));
  return worst < 0 ? null : HEALTH_ORDER[worst]!;
}

// Measurement ids absent from the input are autoscaled replicas, which this model only creates for app servers.
export function measuredType(id: string, topology: Topology) {
  return topology.resources.find((r) => r.id === id)?.type ?? RESOURCE_TYPES.VirtualMachine;
}

export function busiestTypes(terminal: ReportCheckpoint, topology: Topology) {
  const peak = new Map<string, number>();
  for (const resource of terminal.resources) {
    if (resource.cpu === undefined) continue;
    const type = measuredType(resource.id, topology);
    peak.set(type, Math.max(peak.get(type) ?? 0, resource.cpu));
  }
  const top = Math.max(...peak.values());
  return { types: [...peak].filter(([, cpu]) => cpu === top).map(([type]) => type), cpu: top };
}

export function databaseConnections(terminal: ReportCheckpoint, topology: Topology) {
  return topology.resources.filter((r) => r.type === RESOURCE_TYPES.Database).map((db) => {
    const measured = terminal.resources.find((r) => r.id === db.id);
    const skuId = terminal.installedSkus?.[db.id] ?? db.skuId;
    const limit = (skuId ? findSku(skuId)?.maxConnections : undefined) ?? SIMULATION_CONSTANTS.MAX_DB_CONNECTIONS;
    return { id: db.id, name: label(db), connections: measured?.connections, limit };
  });
}

export function scaledOut(terminal: ReportCheckpoint) {
  return Object.values(terminal.pools ?? {}).some((pool) => pool.currentReplicas > pool.baseVmIds.length);
}
