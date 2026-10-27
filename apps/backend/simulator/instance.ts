import type { ActionOutcome, ActionRequest } from "@infraforge/contracts/actions";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import type { RecordedExperiment } from "@infraforge/contracts/challenges";
import type { SimulationLog } from "@infraforge/contracts/telemetry";
import type { SimulationState } from "@infraforge/simulation/types";
import type { EvidenceBuffer } from "../evidence/contract";
import type { Model2Engine } from "./model2Engine";

export interface RunningAction {
  id: string; request: ActionRequest; outcome: ActionOutcome; endSecond?: number; replicaId?: string;
  // Model 2 replica changes: the count before the change, and the second it was applied.
  previousReplicas?: number; appliedSecond?: number;
}
export interface SimulationInstance {
  evidence?: EvidenceBuffer | null;
  // Exactly one engine: Model 1 state, or a Model 2 run (Model 1 is removed before launch).
  state?: SimulationState; model2?: Model2Engine;
  tickCount: number; pendingLogs: SimulationLog[]; speed: number;
  lastCheckpointAt: number; accumulatedCostUsd: number; topology: RunTopology; topologyRevision: number;
  actions: Map<string, RunningAction>;
  metricsComputedAt: string | null;
  metricsTopologyRevision: number;
  // Freeze this instance until the exact acknowledgement succeeds. Never replay its effect.
  acknowledge: (() => Promise<void>) | null;
  // One stop horizon: a rerun's matched stop or a challenge's evaluation second.
  autoStopAtSimulatedSeconds?: number | null;
  stopTrigger?: "matched-stop" | "challenge-evaluation" | "operational-limit";
  finishMatchedStop?: (() => Promise<void>) | null;
  // A resilience attempt's one scheduled fault. Ticks never pass its second until it
  // is durably requested and applied, or durably recorded as failed.
  experiment?: { plan: RecordedExperiment; phase: "scheduled" | "requested" | "applied" | "failed" } | null;
}
export class ActionExecutionError extends Error {}
