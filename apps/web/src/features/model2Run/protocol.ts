import type { ActionOutcome, ActionRequest } from "@infraforge/contracts/actions";
import type { RunTopology, RunProfileSelection } from "@infraforge/contracts/run-inputs";
import type { LiveView, SimulationLog } from "@infraforge/contracts/telemetry";
import type { ResolvedWorkloadProfile } from "@infraforge/domain/workload";

// Messages between the page and the Model 2 run worker.
export interface RunStart {
  input: RunTopology & RunProfileSelection & { workloadProfile: ResolvedWorkloadProfile; seed: string };
  horizonSeconds: number;
  // The run stops by itself here (a challenge's evaluation second, or the horizon).
  stopAtSecond: number;
  // A challenge's scheduled fault, applied right after the run reaches its second.
  experiment?: { fault: Extract<ActionRequest, { kind: "chaos" }>["parameters"]["type"]; resourceId: string; atSimulatedSecond: number };
  speed: number;
}
// What the server needs to replay the run: each accepted action with the simulated second it was applied at.
export interface RunSubmission { stopAtSecond: number; actions: Array<{ atSecond: number; request: ActionRequest }> }

export type ToWorker =
  | { type: "start"; start: RunStart }
  | { type: "speed"; speed: number }
  | { type: "action"; id: string; request: ActionRequest }
  | { type: "stop" };
export type FromWorker =
  | { type: "second"; view: LiveView; logs: SimulationLog[]; burnRatePerHourUsd: number }
  | { type: "action"; id: string; ok: true; outcome: ActionOutcome }
  | { type: "action"; id: string; ok: false; message: string }
  | { type: "done"; submission: RunSubmission }
  | { type: "error"; message: string };
