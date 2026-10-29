import type { ApplicationFlow } from "./ApplicationFlow.interface";
import type { CircuitBreakerSettings } from "./CircuitBreakerSettings.interface";
import type { ResourceType } from "./RESOURCE_TYPES.constants";
import type { AutoscalingPolicy } from "./AutoscalingPolicy.interface";
import type { RetrySettings } from "./RetrySettings.interface";

import type { AsyncQueueSettings, AsyncWorkerSettings } from "./AsyncSettings.interface";

export interface Resource {
  applicationFlow?: ApplicationFlow;
  asyncQueue?: AsyncQueueSettings;
  asyncWorker?: AsyncWorkerSettings;
  id: string;
  type: ResourceType;
  x: number;
  y: number;
  skuId?: string;                  // provider SKU from the catalog (Era 1)
  autoscaling?: AutoscalingPolicy; // pool policy when this resource anchors a VM pool
  circuitBreaker?: CircuitBreakerSettings;
  retry?: RetrySettings;
  public?: boolean;
  encryption?: boolean;
  openPorts?: number[];
  size?: "small" | "medium" | "large";
  region?: string;
  name?: string;
}
