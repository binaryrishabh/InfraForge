import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import { EXPERIMENT_MAX_RESOURCES } from "@infraforge/contracts/reports";
import type { Topology } from "../challenges/criteria";

export function evidenceResourceLimit(topology: Topology): string | null {
  // Model 2's pools: a load balancer with autoscaling on can grow its drawn app servers up to its saved maximum.
  const extra = topology.resources.filter((r) => r.type === RESOURCE_TYPES.LoadBalancer && r.autoscaling?.enabled).reduce((sum, lb) => {
    const drawn = topology.connectionLines.filter((c) => c.sourceId === lb.id).length;
    return sum + Math.max(0, (lb.autoscaling!.maxReplicas ?? drawn) - drawn);
  }, 0);
  const possible = topology.resources.length + extra;
  return possible > EXPERIMENT_MAX_RESOURCES ? `This resilience experiment supports at most ${EXPERIMENT_MAX_RESOURCES} resources including possible autoscaled replicas; this design can reach ${possible}. Reduce the design or pool limits.` : null;
}
