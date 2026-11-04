import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const QUEUE_ACK_DELAY_PROFILE = "queue-ack-delay/1" as const;
export const changedQueueAckDelay = (r: Resource) => r.asyncWorker?.acknowledgementDelayMs !== undefined;
export const queueAckDelayChanges = (resources: readonly Resource[]) => resources.some(changedQueueAckDelay);

type QuantityBuilder = (id: string, value: number, unit: "us", sentence?: string, authored?: boolean) => Quantity<"us">;
export function queueAckDelay(r: Resource, q: QuantityBuilder) {
  const value = r.asyncWorker?.enabled ? r.asyncWorker.acknowledgementDelayMs : undefined;
  return value === undefined ? q(`${r.id}.async.ack`, 0, "us")
    : q(`${r.id}.asyncWorker.acknowledgementDelayMs`, value * 1000, "us", "Saved delay after the result effect before acknowledgement; the delivery still owns prefetch credit and its lease keeps running.", true);
}

export function validateQueueAckDelayBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const worker of input.resources.filter(r => r.kind === "async-worker")) {
    const saved = resources.find(r => r.id === worker.id);
    if (!saved?.asyncWorker?.enabled || requireKnown(worker.ackDelay, "us") !== (saved.asyncWorker.acknowledgementDelayMs ?? 0) * 1000) throw Error("Acknowledgement delay must match saved worker intent");
  }
}
