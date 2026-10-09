import type { SimulationLog } from "@infraforge/contracts/telemetry";
import type { SimulationState } from "./SimulationState.interface";

export interface TickResult {
  state: SimulationState;
  logs: SimulationLog[];
}
