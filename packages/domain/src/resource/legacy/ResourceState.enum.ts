export enum ResourceState {
  healthy = "healthy",
  crash = "crash",
  cpuSpike = 'cpu-spike',
  degraded = "degraded"
}

export type ResourceStateType = (typeof ResourceState)[keyof typeof ResourceState];