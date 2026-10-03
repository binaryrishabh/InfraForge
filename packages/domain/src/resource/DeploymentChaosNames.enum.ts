export enum DeploymentChaosNames {
  Crash = "crash",
  NetworkDelay = "network-delay",
  CpuSpike = "cpu-spike",
  MemoryLeak = "memory-leak",
  DiskFailure = "disk-failure"
}

export type DeploymentChaosNamesType = (typeof DeploymentChaosNames)[keyof typeof DeploymentChaosNames];