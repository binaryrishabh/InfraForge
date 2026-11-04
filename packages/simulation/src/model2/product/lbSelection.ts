import type { Resource } from "@infraforge/domain/resource";
import type { SystemsInput } from "../systems/contracts";

export const LB_SELECTION_PROFILE = "lb-selection/1" as const;
export const changedLbSelection = (r: Resource) => r.type === "Load Balancer" && r.lbSelection !== undefined;
export const lbSelectionChanges = (resources: readonly Resource[]) => resources.some(changedLbSelection);

export function validateLbSelectionBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedLbSelection)) {
    const lb = input.resources.find(d => d.id === r.id);
    if (lb?.kind !== "load-balancer" || lb.policy !== r.lbSelection!.policy) throw Error("Load balancer selection policy must match saved intent");
  }
}
