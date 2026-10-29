import type { InterventionRequest, InterventionTarget } from "@infraforge/domain/resource";
import type { ChaosType } from "@infraforge/domain/resource";
import type { RunTopology } from "../run-inputs/RunInputs.interface";

export type ActionRequest =
  | { kind: "intervention"; parameters: InterventionRequest }
  | { kind: "load"; parameters: { targetLoadFraction: number } }
  | { kind: "speed"; parameters: { speed: 0 | 1 | 10 | 60 } }
  // `trigger` marks the one fault a resilience challenge schedules itself; people never set it.
  | { kind: "chaos"; parameters: { type: ChaosType; resourceId: string; trigger?: "challenge-experiment" } }
  | { kind: "vertical-scale"; parameters: { resourceId: string; skuId: string } }
  | { kind: "pool-scale"; parameters: { lbId: string; delta: 1 | -1 } }
  | { kind: "topology"; parameters: RunTopology & { expectedRevision: number; acceptedRevision?: number } }
  | { kind: "teardown"; parameters: { trigger?: "matched-stop" | "challenge-evaluation" | "operational-limit" } };

export interface InterventionOption {
  interventionId: string; revision: number; target: InterventionTarget; authoredBaseline?: number;
  resolvedTargets: string[]; affectedPaths: string[];
}
export interface InterventionReceipt extends InterventionRequest {
  actionId: string; resolvedTargets: string[]; affectedPaths: string[]; atUs: number; endUs: number | null;
}
export interface ActionOutcome {
  intervention?: InterventionReceipt; interventionEnded?: boolean;
  previousTarget?: number; appliedTarget?: number;
  previousSpeed?: number; appliedSpeed?: number;
  durationSimulatedSeconds?: number; faultEnded?: boolean; observedOverallHealth?: string;
  // Recorded only for a challenge experiment: overall health at the moment the fault was applied.
  baselineOverallHealth?: string;
  fromSkuId?: string | null; requestedSkuId?: string; installedSkuId?: string; online?: boolean;
  delta?: number; previousReplicaCount?: number; finalReplicaCount?: number; replicaId?: string;
  acceptedRevision?: number; appliedRevision?: number; capturedAt?: string;
}

export interface RunAction {
  id: string; deploymentId: string; sequence: number;
  kind: ActionRequest["kind"]; parameters: ActionRequest["parameters"];
  status: "requested" | "applying" | "running" | "completed" | "failed" | "cancelled";
  requestedAt: string; appliedAt: string | null; completedAt: string | null;
  appliedSimulatedSeconds: number | null; completedSimulatedSeconds: number | null;
  outcome: ActionOutcome | null; failureReason: string | null;
}
