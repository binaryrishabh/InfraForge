import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import type { ChaosType } from "@infraforge/domain/resource";

// How long model 1 keeps each fault active, in simulated seconds. One source for
// manual chaos, scheduled challenge experiments and challenge validation.
export const FAULT_DURATIONS: Record<ChaosType, number> = {
  crash: SIMULATION_CONSTANTS.CHAOS.CRASH_DURATION,
  "cpu-spike": SIMULATION_CONSTANTS.CHAOS.CPU_SPIKE_DURATION,
  "memory-leak": SIMULATION_CONSTANTS.CHAOS.MEMORY_LEAK_DURATION,
  "network-delay": SIMULATION_CONSTANTS.CHAOS.NETWORK_DELAY_DURATION,
  "disk-failure": SIMULATION_CONSTANTS.CHAOS.DISK_FAILURE_DURATION,
};
