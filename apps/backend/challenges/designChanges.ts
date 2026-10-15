import type { RunInputs } from "@infraforge/contracts/run-inputs";
import type { DesignChangeReview } from "@infraforge/contracts/reports";
import { canonical } from "../comparison/design";
import { compareInputs } from "../comparison/inputs";
import { rerunInputHash } from "../reruns/options";

// Count factual edits from Honest Compare, not design facets: its one-change-design
// grade means only that the design facet changed, not that exactly one field did.
export function reviewDesignChanges(source: RunInputs, current: RunInputs): DesignChangeReview {
  const starting = compareInputs(source, current), d = starting.design;
  let count: number | null = null;
  if (d && ["inputVersion", "model", "catalog", "workload", "seed"].every((k) => starting.facets[k as keyof typeof starting.facets] === "same")) {
    count = d.added.length + d.removed.length + d.reconfigured.reduce((n, r) => n + r.fields.length, 0) + d.addedConnections.length + d.removedConnections.length;
    // Adding a resource/edge already counts once. Count order as another change
    // only if the relative order of surviving members changes (model-1 semantics).
    const reordered = <T>(a: T[], b: T[]) => {
      const left = a.map(canonical), right = b.map(canonical), common = new Set(left.filter((v) => right.includes(v)));
      return canonical(left.filter((v) => common.has(v))) !== canonical(right.filter((v) => common.has(v)));
    };
    if (d.resourceOrder && reordered(d.resourceOrder.earlier, d.resourceOrder.later)) count++;
    if (d.connectionOrder && reordered(d.connectionOrder.earlier, d.connectionOrder.later)) count++;
  }
  return { classification: count === null ? "unavailable" : count === 0 ? "no-change" : count === 1 ? "one-change" : "several-changes",
    count, differences: d, starting, inputHash: rerunInputHash(current) };
}
