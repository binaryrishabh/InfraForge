import { SimulationLog } from "./SimulationLog.interface";
import { SimulationState } from "./SimulationState.interface";

export interface TickResult {
  state: SimulationState;
  logs: SimulationLog[];
}