export interface ServerlessMetrics {
  version: 1;
  received: number;
  admitted: number;
  completed: number;
  failed: number;
  timedOut: number;
  cancelled: number;
  throttled: number;
  unavailable: number;
  duplicate: number;
  coldStarts: number;
  warmStarts: number;
  initialized: number;
  expired: number;
  scaleOut: number;
  instances: number;
  active: number;
  peakInstances: number;
  downstreamCalls: number;
  downstreamFailed: number;
}
