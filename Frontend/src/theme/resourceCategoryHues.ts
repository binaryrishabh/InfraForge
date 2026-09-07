import { RESOURCE_TYPES, type ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

export type ResourceCategory =
  | "entry-edge"
  | "traffic-security"
  | "compute"
  | "data"
  | "messaging"
  | "observability";

export const CATEGORY_OF_RESOURCE_TYPE: Record<ResourceType, ResourceCategory> = {
  [RESOURCE_TYPES.DNS]: "entry-edge",
  [RESOURCE_TYPES.CDN]: "entry-edge",
  [RESOURCE_TYPES.Firewall]: "traffic-security",
  [RESOURCE_TYPES.LoadBalancer]: "traffic-security",
  [RESOURCE_TYPES.VirtualMachine]: "compute",
  [RESOURCE_TYPES.ContainerRegistry]: "compute",
  [RESOURCE_TYPES.Cache]: "data",
  [RESOURCE_TYPES.Database]: "data",
  [RESOURCE_TYPES.ObjectStorage]: "data",
  [RESOURCE_TYPES.MessageQueue]: "messaging",
  [RESOURCE_TYPES.MonitoringAgent]: "observability",
};

export const CATEGORY_HUE: Record<ResourceCategory, string> = {
  "entry-edge": "#A78BFA",
  "traffic-security": "#60A5FA",
  "compute": "#22D3EE",
  "data": "#2DD4BF",
  "messaging": "#F472B6",
  "observability": "#FACC15",
};

export function hueForType(type: ResourceType): string {
  const category = CATEGORY_OF_RESOURCE_TYPE[type];
  return CATEGORY_HUE[category];
}

// hue + "59" (35% alpha)
export function hueBorder(hue: string): string {
  return `${hue}59`;
}

// hue + "14" (8% alpha)
export function hueTint(hue: string): string {
  return `${hue}14`;
}

// hue + "1A" (10% alpha)
export function hueTile(hue: string): string {
  return `${hue}1A`;
}

export const PANEL_SHELL_CLASS =
  "bg-[#12161F] border border-[#1F2633] rounded-xl p-3";