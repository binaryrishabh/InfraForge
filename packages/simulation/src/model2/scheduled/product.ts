import { schedulerError, resolveScheduler, type Resource, type ConnectionLine } from "@infraforge/domain/resource";
import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import type { ComputeResource } from "../compute/contracts";
import type { SystemsInput } from "../systems/contracts";
import type { SchedulerConfig } from "./contracts";
export const SCHEDULER_PROFILE = "scheduler/1" as const;
export const schedulerIntent = (resources: readonly Resource[]) => resources.some(r => r.type === "Scheduler" || r.scheduler !== undefined);
type Q = <U extends Unit>(id: string, value: number, unit: U, sentence?: string, authored?: boolean) => Quantity<U>;
const quantities = { startMs: ["start", "us", 1000], periodMs: ["period", "us", 1000], maxTriggers: ["maxTriggers", "count", 1], maxConcurrent: ["maxConcurrent", "count", 1], queueCapacity: ["queueCapacity", "count", 1], maxAttempts: ["maxAttempts", "count", 1], retryDelayMs: ["retryDelay", "us", 1000], timeoutMs: ["timeout", "us", 1000], maxLatenessMs: ["maxLateness", "us", 1000] } as const;
export function schedulerTarget(r: Resource, resources: readonly Resource[], connections: readonly ConnectionLine[]) {
  const edges = connections.filter(e => e.sourceId === r.id), target = resources.find(t => t.id === edges[0]?.targetId);
  if (edges.length !== 1 || !target || target.type !== "Virtual Machine" || target.asyncWorker?.enabled || target.autoscaling?.enabled || connections.some(e => e.targetId === r.id && resources.find(s => s.id === e.sourceId)?.type !== "Firewall")) throw Error("Scheduler requires exactly one fixed app target and no inbound application calls");
  return target;
}
export function schedulerTemplate(r: Resource, resources: readonly Resource[], connections: readonly ConnectionLine[], execution: ComputeResource, q: Q): Omit<SchedulerConfig, "id"> {
  const s = resolveScheduler(r.scheduler), target = schedulerTarget(r, resources, connections);
  const values = Object.fromEntries(Object.entries(quantities).map(([key, [field, unit, scale]]) => [field, q(`${r.id}.scheduler.${key}`, s[key as keyof typeof quantities] * scale, unit, "Educational simulated-time trigger policy; destination owns idempotency; no physical timing or availability claim.", r.scheduler?.[key as keyof typeof quantities] !== undefined)]));
  return { ...values, kind: "scheduler", profile: "bounded-simulated-triggers/1", execution, target: `$${target.id}`, overlap: s.overlap, missed: s.missed, operation: s.operation } as Omit<SchedulerConfig, "id">;
}
export function validateSchedulerBindings(resources: readonly Resource[], connections: readonly ConnectionLine[], input: SystemsInput) {
  for (const r of resources) {
    const error = schedulerError(r.type, r.scheduler); if (error) throw Error(error);
    if (r.type !== "Scheduler") continue;
    const actual = input.resources.find(s => s.id === r.id), s = resolveScheduler(r.scheduler), target = schedulerTarget(r, resources, connections);
    if (actual?.kind !== "scheduler" || actual.target !== target.id || actual.overlap !== s.overlap || actual.missed !== s.missed || actual.operation !== s.operation) throw Error("Scheduler must match saved target and policy");
    for (const [key, [field, unit, scale]] of Object.entries(quantities)) if (requireKnown(actual[field], unit) !== s[key as keyof typeof quantities] * scale) throw Error("Scheduler quantities must match saved intent");
  }
}
