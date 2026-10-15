import { sumQuantities, requireKnown, type Quantity } from "../../reality/quantity";
import type { ComputeResource, ComputeProfile } from "./contracts";

const scale = (q: Quantity<"bytes">, count: number): Quantity<"bytes"> => {
  if (q.kind === "unknown") return q; // Unknown ownership is not replaced with zero.
  const values = q.kind === "known" ? [q.value * count] : [q.min * count, q.max * count];
  if (values.some((v) => !Number.isSafeInteger(v))) throw new Error("Modeled resident byte accounting overflow");
  return q.kind === "known" ? { ...q, value: values[0]! } : { ...q, min: values[0]!, max: values[1]! };
};
export function residentMemory(config: ComputeResource, profiles: Map<string, ComputeProfile>) {
  const owned = new Map<string, { operation: string; active: boolean }>();
  const measure = (extra?: { operation: string; active: boolean }) => {
    const components: Record<string, Quantity<"bytes">> = {};
    if (config.memory.baseline) components.baseline = config.memory.baseline;
    if (config.memory.perWorker) components.workers = scale(config.memory.perWorker, requireKnown(config.workers, "count"));
    if (config.memory.retained) components.retained = config.memory.retained;
    for (const part of config.memory.components ?? []) components[`process-component:${part.id}`] = scale(part.bytes, part.owner === "worker" ? requireKnown(config.workers, "count") : 1);
    const unknown = (): Quantity<"bytes"> => ({ kind: "unknown", unit: "bytes", provenance: ["m2c.partial-resident"], reason: "Declared resident coverage is partial" });
    if (config.memory.coverage === "partial") components.unmodeledProcess = unknown();
    const populations = [...owned.values(), ...(extra ? [extra] : [])];
    for (const [operation, p] of profiles) {
      const admitted = populations.filter((v) => v.operation === operation).length, active = populations.filter((v) => v.operation === operation && v.active).length;
      if (p.requestResidentBytes) components[`request:${operation}`] = scale(p.requestResidentBytes, admitted);
      if (p.activeResidentBytes) components[`active:${operation}`] = scale(p.activeResidentBytes, active);
      for (const part of p.residentComponents ?? []) components[`request-component:${operation}:${part.id}`] = scale(part.bytes, part.owner === "active" ? active : admitted);
      if (admitted && p.residentCoverage === "partial") components[`unmodeledRequest:${operation}`] = unknown();
    }
    const total = Object.keys(components).length ? sumQuantities(Object.values(components), "bytes") : { kind: "known" as const, value: 0, unit: "bytes" as const, provenance: ["m2c.empty-resident"] }, limit = config.memory.limit ? requireKnown(config.memory.limit, "bytes") : null;
    const knownSubtotalBytes = Object.values(components).reduce((sum, q) => sum + (q.kind === "known" ? q.value : 0), 0);
    if (!Number.isSafeInteger(knownSubtotalBytes) || (total.kind === "known" && !Number.isSafeInteger(total.value)) || (total.kind === "range" && (!Number.isSafeInteger(total.min) || !Number.isSafeInteger(total.max)))) throw new Error("Modeled resident total byte overflow");
    return { ownership: { requests: populations.length, active: populations.filter((p) => p.active).length }, knownSubtotalBytes, totalResidentBytes: total, components, limitBytes: limit,
      comparison: total.kind !== "known" || limit === null ? "unknown" as const : total.value > limit ? "exceeds" as const : "within" as const, policy: config.memory.policy };
  };
  return {
    acquire(id: string, operation: string, active: boolean) {
      if (owned.has(id)) throw new Error("Duplicate memory owner");
      if (config.memory.policy === "reject-allocation" && measure({ operation, active }).comparison === "exceeds") return false;
      owned.set(id, { operation, active }); return true;
    },
    activate(id: string) {
      const owner = owned.get(id)!; owned.delete(id);
      if (config.memory.policy === "reject-allocation" && measure({ ...owner, active: true }).comparison === "exceeds") { owned.set(id, owner); return false; }
      owned.set(id, { ...owner, active: true }); return true;
    },
    release(id: string) { if (!owned.delete(id)) throw new Error("Missing memory owner"); }, measure,
  };
}
