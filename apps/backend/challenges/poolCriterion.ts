import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import type { Topology } from "./criteria";
import { StartupSchema } from "../reports/startupSchema";

export type PoolCriterion = Extract<ChallengeCriterion, {kind: "pool-in-service"}>;
const safe = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Terminal pool readings for a pool whose saved scaling signal is delivered monitoring samples. Missing evidence stays Unknown. */
export function evaluatePoolInService(c: PoolCriterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number, active: boolean): {met?: boolean; detail: string; sources: string[]} {
  const sources = ["runInputs.resources", "terminalSnapshot.metrics.startup"];
  const unknown = (detail: string) => ({detail, sources});
  if (active || !input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") {
    return unknown("A completed run with a current terminal measurement at the exact evaluation second is required.");
  }
  const pools = input.resources.filter(r => r.id === c.resourceId);
  const signal = pools[0]?.autoscaling?.signal;
  if (pools.length !== 1 || pools[0]!.type !== RESOURCE_TYPES.VirtualMachine || pools[0]!.autoscaling?.enabled !== true || signal?.source !== "observed-core-time") {
    return unknown("The captured design must retain the named autoscaled app server with its delivered-sample scaling signal.");
  }
  const rows = terminal.resources.filter(r => r.id === c.resourceId);
  const parsed = rows.length === 1 ? StartupSchema.safeParse(rows[0]!.startup) : undefined;
  const controllers = parsed?.success ? (parsed.data.controllers ?? []).filter(k => k.id === c.resourceId) : [];
  if (controllers.length !== 1) return unknown("Exactly one valid controller reading for the named pool is required.");
  const k = controllers[0]!;
  if (parsed!.data.sampledAtUs !== second * 1_000_000) return unknown("The pool reading must carry its exact sample time at the evaluation boundary; a missing time stays Unknown.");
  if (!safe(k.inService) || !safe(k.desired) || !safe(k.evaluations) || !safe(k.missingMeasurements) || k.missingMeasurements > k.evaluations || k.signal?.source !== "observed-core-time") {
    return unknown("Safe desired, in-service, evaluation and missing-measurement counts from the delivered-sample signal are required.");
  }
  const rowsKnown = k.replicas != null && k.omittedReplicas === 0 && k.replicas.every(r => [r.endpointAlive, r.endpointReady, r.lbHealthy, r.lbDraining].every(v => typeof v === "boolean"));
  if (!rowsKnown || k.replicas!.filter(r => r.state === "ready" && r.endpointAlive && r.endpointReady && r.lbHealthy && !r.lbDraining).length !== k.inService) {
    return unknown("The in-service count must reconcile with complete retained replica rows; otherwise it stays Unknown.");
  }
  return {met: k.inService >= c.minInService,
    detail: `At second ${second}, ${c.resourceId} has ${k.inService} in service (minimum ${c.minInService}), desired ${k.desired}; ${k.missingMeasurements} of ${k.evaluations} evaluations had no usable delivered measurements.`, sources};
}
