import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
const C = SIMULATION_CONSTANTS.CHAOS;
// Labels for legacy recorded faults and server-authored experiments. Live choices use capabilities.
export const FAULTS: Array<{ id: DeploymentChaosNames; label: string; seconds: number; effect: string }> = [
  {id: DeploymentChaosNames.Crash, label: "Crash", seconds: C.CRASH_DURATION, effect: "Aborts owned work and restarts the supported process after the fault ends."},
  {id: DeploymentChaosNames.CpuSpike, label: "CPU spike", seconds: C.CPU_SPIKE_DURATION, effect: "A competing process holds 45% of the target's modeled cores."},
  {id: DeploymentChaosNames.NetworkDelay, label: "Network delay", seconds: C.NETWORK_DELAY_DURATION, effect: "Adds 200,000 us of propagation delay on materialized links into the target."},
];
