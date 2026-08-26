export enum ResourceHealth {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  SATURATED = "saturated",
  FAILED = "failed"
}

export type ResourceHealthType = (typeof ResourceHealth)[keyof typeof ResourceHealth];