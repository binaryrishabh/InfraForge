import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const WORKER_WAIT_PROFILE = "worker-wait/1" as const;
export const changedWorkerWait = (r: Resource) => r.asyncWorker?.enabled === true && r.asyncWorker.externalWaitMs !== undefined;
export const workerWaitChanges = (resources: readonly Resource[]) => resources.some(changedWorkerWait);

type QuantityBuilder = (id: string, value: number, unit: "us", sentence?: string, authored?: boolean) => Quantity<"us">;
/** Saved per-job wait on an assumed external dependency; the job keeps its parallel slot and prefetch credit, spends no CPU while waiting. */
export function workerWait(r: Resource, q: QuantityBuilder) {
  const value = changedWorkerWait(r) ? r.asyncWorker!.externalWaitMs : undefined;
  return value === undefined ? q(`${r.id}.async.wait`, 0, "us")
    : q(`${r.id}.asyncWorker.externalWaitMs`, value * 1000, "us", "Authored assumption: each job waits this long on an external dependency after its CPU work, holding its parallel slot and lease but no CPU.", true);
}

export function validateWorkerWaitBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const worker of input.resources.filter(r => r.kind === "async-worker")) {
    const saved = resources.find(r => r.id === worker.id);
    if (!saved?.asyncWorker?.enabled || requireKnown(worker.blockingWait, "us") !== (saved.asyncWorker.externalWaitMs ?? 0) * 1000) throw Error("External wait must match saved worker intent");
  }
}
