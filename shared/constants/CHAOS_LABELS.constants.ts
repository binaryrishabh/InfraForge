import { DeploymentChaosNames } from "../enum/DeploymentChaosNames.enum";

export const CHAOS_LABELS: Record<DeploymentChaosNames, string> = {
  [DeploymentChaosNames.Crash]: "Crash",
  [DeploymentChaosNames.CpuSpike]: "CPU Spike",
  [DeploymentChaosNames.MemoryLeak]: "Memory Leak",
  [DeploymentChaosNames.NetworkDelay]: "Network Delay",
  [DeploymentChaosNames.DiskFailure]: "Disk Failure"
};

export type ChaosLabelsType = typeof CHAOS_LABELS;