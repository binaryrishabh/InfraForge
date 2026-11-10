import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const QUEUE_REDRIVE_PROFILE = "queue-redrive/1" as const;
export const changedQueueRedrive = (r: Resource) => (r.asyncQueue?.enabled === true && r.asyncQueue.redriveAtSecond !== undefined) || (r.asyncWorker?.enabled === true && r.asyncWorker.repairAtSecond !== undefined);
export const queueRedriveChanges = (resources: readonly Resource[]) => resources.some(changedQueueRedrive);

type Q = (id: string, value: number, unit: "us", sentence?: string, authored?: boolean) => Quantity<"us">;
/** Optional fields appear only for marked designs, so unmarked queue and worker bytes stay identical. */
export const queueRedriveField = (r: Resource, q: Q) => r.asyncQueue?.enabled && r.asyncQueue.redriveAtSecond !== undefined
  ? { redriveAt: q(`${r.id}.asyncQueue.redriveAtSecond`, r.asyncQueue.redriveAtSecond * 1000000, "us", "Saved second at which every dead-lettered message returns to the queue once.", true) } : {};
export const workerRepairField = (r: Resource, q: Q) => r.asyncWorker?.enabled && r.asyncWorker.repairAtSecond !== undefined
  ? { repairAt: q(`${r.id}.asyncWorker.repairAtSecond`, r.asyncWorker.repairAtSecond * 1000000, "us", "Saved second from which the worker's bad jobs no longer fail.", true) } : {};

export function validateQueueRedriveBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources) {
    const res = input.resources.find(c => c.id === r.id);
    if (res?.kind === "delivery-queue") {
      const saved = r.asyncQueue?.enabled ? r.asyncQueue.redriveAtSecond : undefined;
      if ((saved === undefined) !== (res.redriveAt === undefined) || (saved !== undefined && requireKnown(res.redriveAt!, "us") !== saved * 1000000)) throw Error("Queue redrive must match saved queue intent");
    }
    if (res?.kind === "async-worker") {
      const saved = r.asyncWorker?.enabled ? r.asyncWorker.repairAtSecond : undefined;
      if ((saved === undefined) !== (res.repairAt === undefined) || (saved !== undefined && requireKnown(res.repairAt!, "us") !== saved * 1000000)) throw Error("Worker repair must match saved worker intent");
    }
  }
}
