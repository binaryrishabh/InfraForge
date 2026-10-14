import { RESOURCE_TYPES, type ResourceType } from "@infraforge/domain/resource";

export type ResourceCategory = "entry" | "traffic" | "compute" | "data" | "messaging" | "observe";

export const CATEGORY_OF: Record<ResourceType, ResourceCategory> = {
  [RESOURCE_TYPES.DNS]: "entry",
  [RESOURCE_TYPES.CDN]: "entry",
  [RESOURCE_TYPES.Firewall]: "traffic",
  [RESOURCE_TYPES.LoadBalancer]: "traffic",
  [RESOURCE_TYPES.VirtualMachine]: "compute",
  [RESOURCE_TYPES.ContainerRegistry]: "compute",
  [RESOURCE_TYPES.Cache]: "data",
  [RESOURCE_TYPES.Database]: "data",
  [RESOURCE_TYPES.ObjectStorage]: "data",
  [RESOURCE_TYPES.MessageQueue]: "messaging",
  [RESOURCE_TYPES.MonitoringAgent]: "observe",
};

export const CATEGORY_LABEL: Record<ResourceCategory, string> = {
  entry: "Entry and edge", traffic: "Traffic and security", compute: "Compute",
  data: "Data", messaging: "Messaging", observe: "Observability",
};

// Category colour is identity only; it never carries state.
export const categoryColor = (type: ResourceType) => `var(--if-cat-${CATEGORY_OF[type] ?? "entry"})`;
