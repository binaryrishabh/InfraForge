export enum ResourceHealth {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  SATURATED = "saturated",
  FAILED = "failed",
  // Model 2 does not model this component's health (e.g. a pure policy node): never shown as healthy.
  UNKNOWN = "unknown"
}

export type ResourceHealthType = (typeof ResourceHealth)[keyof typeof ResourceHealth];