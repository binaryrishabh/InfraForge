import type { ActionOutcome, ActionRequest } from "@infraforge/contracts/actions";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import type { RecordedExperiment } from "@infraforge/contracts/challenges";
import type { SimulationLog } from "@infraforge/contracts/telemetry";
import type { EvidenceBuffer } from "../evidence/contract";
import type { Model2Engine } from "./model2Engine";
import type { BrowserSubmission } from "../browserRuns/submission";

export interface RunningAction {
  id: string; request: ActionRequest; outcome: ActionOutcome; endSecond?: number;
  // Replica changes: the count before the change, and the second it was applied.
  previousReplicas?: number; appliedSecond?: number;
}
export interface SimulationInstance {
  evidence?: EvidenceBuffer | null;
  model2: Model2Engine;
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
  // A browser run's server replay: the submitted actions, each recorded as a run action at its second.
  replay?: { actions: BrowserSubmission["actions"]; next: number } | null;
}
export class ActionExecutionError extends Error {}
