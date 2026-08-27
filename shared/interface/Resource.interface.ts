import type { ResourceType } from "../constants/RESOURCE_TYPES.constants";

export interface Resource {
  id: string;
  type: ResourceType;
  x: number;
  y: number;
  skuId?: string;             // provider SKU from the catalog (Era 1)
  public?: boolean;
  encryption?: boolean;
  openPorts?: number[];
  size?: "small" | "medium" | "large";
  region?: string;
  name?: string;
}