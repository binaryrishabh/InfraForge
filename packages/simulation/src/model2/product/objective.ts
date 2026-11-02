import { workloadObjectiveError, type WorkloadProfile } from "@infraforge/domain/workload";
import type { ProductContract } from "./contracts";

// The captured workload gates observation; it selects no physics adapter or new events.
export function compileObjective(p: WorkloadProfile, contract: ProductContract) {
  const error = workloadObjectiveError(p.workloadObjective); if (error) throw Error(error);
  if (p.workloadObjective) contract.workloadObjective = { ...p.workloadObjective };
}

export function checkObjective(p: WorkloadProfile, contract: ProductContract) {
  const a = p.workloadObjective, b = contract.workloadObjective;
  const error = workloadObjectiveError(a) ?? workloadObjectiveError(b); if (error) throw Error(error);
  if (!!a !== !!b || a?.version !== b?.version || a?.maxResponseMs !== b?.maxResponseMs || a?.targetSuccessPercent !== b?.targetSuccessPercent)
    throw Error("Service objective must match the captured workload intent.");
}
