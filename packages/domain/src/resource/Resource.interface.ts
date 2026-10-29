import type { ResourceType } from "./RESOURCE_TYPES.constants";
import type { AutoscalingPolicy } from "./AutoscalingPolicy.interface";
import type { RetrySettings } from "./RetrySettings.interface";

export interface Resource {
  id: string;
  type: ResourceType;
  x: number;
  y: number;
  skuId?: string;                  // provider SKU from the catalog (Era 1)
  autoscaling?: AutoscalingPolicy; // pool policy when this resource anchors a VM pool
  retry?: RetrySettings;
  public?: boolean;
  encryption?: boolean;
  openPorts?: number[];
  size?: "small" | "medium" | "large";
  region?: string;
  name?: string;
}
