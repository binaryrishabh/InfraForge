import { RESOURCE_TYPES, type ResourceType } from "./RESOURCE_TYPES.constants";

/* A rule specifing between which resources connections could be done and which one will be the source and which 
one will be the target */
export const CONNECTION_RULES: Record<ResourceType, Array<ResourceType>> = {
  [RESOURCE_TYPES.DNS]: [RESOURCE_TYPES.CDN, RESOURCE_TYPES.LoadBalancer],
  [RESOURCE_TYPES.CDN]: [RESOURCE_TYPES.LoadBalancer],
  [RESOURCE_TYPES.Firewall]: [RESOURCE_TYPES.LoadBalancer, RESOURCE_TYPES.VirtualMachine, RESOURCE_TYPES.Database],
  [RESOURCE_TYPES.LoadBalancer]: [RESOURCE_TYPES.VirtualMachine],
  [RESOURCE_TYPES.VirtualMachine]: [RESOURCE_TYPES.Database, RESOURCE_TYPES.Cache, RESOURCE_TYPES.MessageQueue, RESOURCE_TYPES.ContainerRegistry, RESOURCE_TYPES.ObjectStorage],
  [RESOURCE_TYPES.ContainerRegistry]: [],
  [RESOURCE_TYPES.Cache]: [RESOURCE_TYPES.Database],
  [RESOURCE_TYPES.Database]: [RESOURCE_TYPES.ObjectStorage],
  [RESOURCE_TYPES.MessageQueue]: [RESOURCE_TYPES.VirtualMachine, RESOURCE_TYPES.Database],
  [RESOURCE_TYPES.ObjectStorage]: [], // End node, receives connections, doesn't initiate a connection
  [RESOURCE_TYPES.MonitoringAgent]: [RESOURCE_TYPES.VirtualMachine, RESOURCE_TYPES.Database, RESOURCE_TYPES.Cache, RESOURCE_TYPES.MessageQueue]
} as const;

export type CONNECTION_RULES_TYPE = typeof CONNECTION_RULES;