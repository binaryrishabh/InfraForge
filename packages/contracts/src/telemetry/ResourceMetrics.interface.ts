import type { ResourceHealthType } from "@infraforge/domain/resource";

import type { AsyncQueueMetrics } from "./AsyncQueueMetrics.interface";

export interface ResourceMetrics {
  database?: import("./DataDeliveryMetrics.interface").DatabaseMetrics;
  cache?: import("./DataDeliveryMetrics.interface").CacheMetrics;
  cdn?: import("./DataDeliveryMetrics.interface").CdnMetrics;
  security?: import("./SecurityMetrics.interface").SecurityMetrics;
  asyncQueue?: AsyncQueueMetrics;
  cpu: number | null;
  memory: number | null;
  connections?: number;
  rps?: number;
  health: ResourceHealthType;
  // Model 2 replica pools: replicas up and serving, and replicas that exist (starting, ready or draining).
  replicas?: { ready: number; total: number };
}
