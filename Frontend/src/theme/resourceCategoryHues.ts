import { RESOURCE_TYPES, type ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";
import { PALETTE } from "./palette";

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

/* Muted stripe tones for the 2px card edge. Untouched by the icon-badge
round — node borders and backgrounds keep their existing language. */
export const CATEGORY_STRIPE: Record<ResourceCategory, string> = {
  "entry-edge": "#7C8798",
  "traffic-security": "#4FA89B",
  compute: "#B58A5A",
  data: "#5E8CA8",
  messaging: "#A8785E",
  observability: "#8CA85E",
};

/* Vivid category colors for ICON BADGES — canvas cards, resource sidebar,
inspector. One map, one language: the same category always wears the same
color regardless of instance (vm-1 and vm-2 match, every Database-* matches).
Exact owner-specified mapping; unknown categories fall back to neutral gray. */
export const CATEGORY_COLOR: Record<ResourceCategory, string> = {
  "entry-edge": "#7B88B8",
  "traffic-security": "#4A7FE0",
  compute: "#3FA88C",
  data: "#3FA0B8",
  messaging: "#D45FA0",
  observability: "#E0A83D",
};

export function stripeForType(type: ResourceType): string {
  return CATEGORY_STRIPE[CATEGORY_OF_RESOURCE_TYPE[type]];
}

export function categoryColorForType(type: ResourceType): string {
  return CATEGORY_COLOR[CATEGORY_OF_RESOURCE_TYPE[type]] ?? "#5A5F6B";
}

/* Badge background = the category color at ~15% opacity (hex alpha 26).
Shared by every badge site so tints never drift apart. */
export function categoryBadgeTint(type: ResourceType): string {
  return `${categoryColorForType(type)}26`;
}

/* Legacy aliases kept so existing import sites keep compiling while the
sweep lands; they resolve to control-room tokens instead of vivid hues. */
export const hueForType = stripeForType;
export function hueBorder(_hue: string): string {
  return PALETTE.border;
}
export function hueTint(hue: string): string {
  return `${hue}14`;
}
export function hueTile(hue: string): string {
  return `${hue}1A`;
}
export const PANEL_SHELL_CLASS =
  "bg-[#1C1F26] border border-[#2A2E37] rounded-lg p-3";