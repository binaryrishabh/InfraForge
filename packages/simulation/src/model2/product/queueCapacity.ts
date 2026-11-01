import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const QUEUE_CAPACITY_PROFILE = "queue-capacity/1" as const;
export const changedQueueCapacity = (r: Resource) => r.asyncQueue?.capacityMessages !== undefined;
export const queueCapacityChanges = (resources: readonly Resource[]) => resources.some(changedQueueCapacity);

type QuantityBuilder = (id: string, value: number, unit: "count", sentence?: string, authored?: boolean) => Quantity<"count">;
export function queueMessageCapacity(r: Resource, cores: number, q: QuantityBuilder) {
  const value = r.asyncQueue?.enabled ? r.asyncQueue.capacityMessages : undefined;
  return value === undefined ? q(`${r.id}.capacity`, 1000 * cores, "count")
    : q(`${r.id}.asyncQueue.capacityMessages`, value, "count", "Saved educational live-message limit; full queues refuse new publishes. Physical storage guarantees Unknown.", true);
}

export function validateQueueCapacityBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedQueueCapacity)) {
    const broker = input.resources.find(b => b.id === r.id);
    if (r.type !== "Message Queue" || broker?.kind !== "delivery-queue") throw Error("Queue capacity requires its owned delivery queue");
    if (r.asyncQueue!.enabled && requireKnown(broker.capacityMessages, "count") !== r.asyncQueue!.capacityMessages) throw Error("Live-message capacity must match saved queue intent");
  }
}
