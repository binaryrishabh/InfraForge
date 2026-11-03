import { eventBusError, resolveEventBus, type Resource, type ConnectionLine } from "@infraforge/domain/resource";
import type { Quantity, Unit } from "../../reality/quantity";
import { requireKnown } from "../../reality/quantity";
import type { CommandConfig } from "../async/contracts";
import type { EventBusConfig } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const EVENT_BUS_PROFILE = "event-bus/1" as const;
export const eventBusIntent = (resources: readonly Resource[]) => resources.some(r => r.type === "Event Bus" || r.eventBus !== undefined);
type Q = <U extends Unit>(id: string, value: number, unit: U, sentence?: string, authored?: boolean) => Quantity<U>;
export function eventSubscriptions(r: Resource, connections: readonly ConnectionLine[]): import("@infraforge/domain/resource").EventSubscription[] {
  return r.eventBus?.subscriptions ?? connections.filter(e => e.sourceId === r.id).sort((a, b) => a.id < b.id ? -1 : 1).map(e => ({ id: e.id, edge: e.id }));
}
export function eventBusTemplate(r: Resource, connections: readonly ConnectionLine[], command: CommandConfig, q: Q): Omit<EventBusConfig, "id"> {
  const settings = resolveEventBus(r.eventBus);
  const quantity = <U extends "count" | "us">(key: keyof typeof settings, unit: U, scale = 1) => q(`${r.id}.eventBus.${key}`, settings[key] * scale, unit, "Bounded logical per-subscription delivery policy; physical durability Unknown.", r.eventBus?.[key] !== undefined);
  const subscriptions = eventSubscriptions(r, connections).map(s => {
    const edge = connections.find(e => e.id === s.edge && e.sourceId === r.id);
    if (!edge || edge.targetType !== "Message Queue") throw Error("Event subscription must reference its outgoing Message Queue edge");
    return { id: s.id, target: `$${edge.targetId}`, ...(s.filter ? { keyPrefix: s.filter.keyPrefix } : {}) };
  });
  if (subscriptions.length < 1 || subscriptions.length > 16 || subscriptions.length !== connections.filter(e => e.sourceId === r.id).length) throw Error("Every event bus output requires exactly one subscription (1 to 16)");
  return { ...command, kind: "event-bus", profile: "independent-pubsub/1", subscriptions, capacityMessages: quantity("capacityMessages", "count"), maxAttempts: quantity("maxAttempts", "count"), retryDelay: quantity("retryDelayMs", "us", 1000), deliveryTimeout: quantity("deliveryTimeoutMs", "us", 1000), deadLetterCapacity: quantity("deadLetterCapacity", "count") };
}
export function validateEventBusBindings(resources: readonly Resource[], connections: readonly ConnectionLine[], input: SystemsInput) {
  for (const r of resources) {
    const error = eventBusError(r.type, r.eventBus); if (error) throw Error(error);
    if (r.type !== "Event Bus") continue;
    const runtime = input.resources.find(b => b.id === r.id), expected = resolveEventBus(r.eventBus);
    if (runtime?.kind !== "event-bus") throw Error("Event Bus requires its own runtime owner");
    for (const [key, quantity, unit, scale] of [["capacityMessages", runtime.capacityMessages, "count", 1], ["maxAttempts", runtime.maxAttempts, "count", 1], ["retryDelayMs", runtime.retryDelay, "us", 1000], ["deliveryTimeoutMs", runtime.deliveryTimeout, "us", 1000], ["deadLetterCapacity", runtime.deadLetterCapacity, "count", 1]] as const) if (requireKnown(quantity, unit) !== expected[key] * scale) throw Error("Event Bus policy must match saved intent");
    const subscriptions = eventSubscriptions(r, connections).map(s => ({ id: s.id, target: connections.find(e => e.id === s.edge && e.sourceId === r.id)?.targetId, ...(s.filter ? { keyPrefix: s.filter.keyPrefix } : {}) }));
    if (JSON.stringify(runtime.subscriptions) !== JSON.stringify(subscriptions)) throw Error("Event Bus subscriptions must match saved edge and filter intent");
  }
}
