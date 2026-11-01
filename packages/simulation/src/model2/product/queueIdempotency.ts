import type { Resource } from "@infraforge/domain/resource";
import type { SystemsInput } from "../systems/contracts";

export const QUEUE_IDEMPOTENCY_PROFILE = "queue-idempotency/1" as const;
export const changedQueueIdempotency = (r: Resource) => r.asyncWorker?.idempotentResults === true;
export const queueIdempotencyChanges = (resources: readonly Resource[]) => resources.some(changedQueueIdempotency);
export const resultWritePolicy = (r: Resource) => r.asyncWorker?.enabled && changedQueueIdempotency(r) ? "object-if-absent" as const : "none" as const;

export function validateQueueIdempotencyBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const worker of input.resources.filter(r => r.kind === "async-worker")) {
    const saved = resources.find(r => r.id === worker.id);
    if (!saved?.asyncWorker?.enabled || worker.idempotency !== resultWritePolicy(saved)) throw Error("Result write policy must match saved worker intent");
    if (worker.idempotency === "object-if-absent" && worker.database) throw Error("Idempotent result writes protect Object Storage only; database side effects are unsupported");
  }
}
