import { createInitialState } from "@infraforge/simulation/engine";
import { EXPERIMENT_MAX_RESOURCES } from "@infraforge/contracts/reports";
import type { Topology } from "../challenges/criteria";

export function evidenceResourceLimit(topology: Topology): string | null {
  // Use the model's pool limits, including its defaults and cap, rather than a
  // second interpretation of autoscaling. No simulation tick or prediction runs.
  const state = createInitialState("evidence-bounds", topology.resources, topology.connectionLines,
    { targetThroughput: 1, throughputUnit: "per-minute", trafficShape: "steady", payloadSize: "medium" }, 0);
  const possible = topology.resources.length + Object.values(state.pools).reduce((sum, pool) =>
    sum + Math.max(0, pool.maxReplicas - pool.baseVmIds.length), 0);
  return possible > EXPERIMENT_MAX_RESOURCES ? `This resilience experiment supports at most ${EXPERIMENT_MAX_RESOURCES} resources including possible autoscaled replicas; this design can reach ${possible}. Reduce the design or pool limits.` : null;
}
