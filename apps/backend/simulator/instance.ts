import type { ActionOutcome, ActionRequest } from "@infraforge/contracts/actions";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import type { SimulationLog } from "@infraforge/contracts/telemetry";
import type { SimulationState } from "@infraforge/simulation/types";

export interface RunningAction {
  id: string; request: ActionRequest; outcome: ActionOutcome; endSecond?: number; replicaId?: string;
}
export interface SimulationInstance {
  state: SimulationState; tickCount: number; pendingLogs: SimulationLog[]; speed: number;
  lastCheckpointAt: number; accumulatedCostUsd: number; topology: RunTopology; topologyRevision: number;
  actions: Map<string, RunningAction>;
  metricsComputedAt: string | null;
  metricsTopologyRevision: number;
  // Freeze this instance until the exact acknowledgement succeeds. Never replay its effect.
  acknowledge: (() => Promise<void>) | null;
}
export class ActionExecutionError extends Error {}
