import { capacityLayout, capacityWorkload } from "./queueCapacity.fixture";

export const idempotencyWorkload = capacityWorkload;
export function idempotencyLayout(idempotentResults?: boolean, publishFlow = false, capacityMessages?: number) {
  const layout = capacityLayout(capacityMessages, publishFlow);
  if (idempotentResults !== undefined) layout.resources.find(r => r.id === "worker")!.asyncWorker!.idempotentResults = idempotentResults;
  return layout;
}
