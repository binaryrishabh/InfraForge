import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";

const C = SIMULATION_CONSTANTS.CHAOS;

// What each injected fault does in simulation model 1, stated from its constants.
export const FAULTS: Array<{ id: DeploymentChaosNames; label: string; seconds: number; effect: string }> = [
  { id: DeploymentChaosNames.Crash, label: "Crash", seconds: C.CRASH_DURATION, effect: "Takes the resource out of service; it reports failed and receives no traffic." },
  { id: DeploymentChaosNames.CpuSpike, label: "CPU spike", seconds: C.CPU_SPIKE_DURATION, effect: `Adds ${C.CPU_SPIKE_BOOST} points of CPU.` },
  { id: DeploymentChaosNames.MemoryLeak, label: "Memory leak", seconds: C.MEMORY_LEAK_DURATION, effect: `Memory grows by ${C.MEMORY_LEAK_RATE} points each simulated second.` },
  { id: DeploymentChaosNames.NetworkDelay, label: "Network delay", seconds: C.NETWORK_DELAY_DURATION, effect: `Multiplies CPU by ${C.NETWORK_DELAY_CPU_FACTOR}.` },
  { id: DeploymentChaosNames.DiskFailure, label: "Disk failure", seconds: C.DISK_FAILURE_DURATION, effect: "Pins CPU at 100%." },
];
