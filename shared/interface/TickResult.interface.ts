import type { SimulationLog } from "./SimulationLog.interface";
import type { SimulationState } from "./SimulationState.interface";

export interface TickResult {
  state: SimulationState;
  logs: SimulationLog[];
}
