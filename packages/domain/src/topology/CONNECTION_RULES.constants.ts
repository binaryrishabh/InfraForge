import { RESOURCE_TYPES, type ResourceType } from "../resource/RESOURCE_TYPES.constants";

/* A rule specifing between which resources connections could be done and which one will be the source and which 
one will be the target */
export const CONNECTION_RULES: Record<ResourceType, Array<ResourceType | { target: ResourceType; requires: "application-flow" | "application-flow/2" }>> = {
  [RESOURCE_TYPES.EventBus]: [RESOURCE_TYPES.MessageQueue],
  [RESOURCE_TYPES.DNS]: [RESOURCE_TYPES.CDN, RESOURCE_TYPES.LoadBalancer, RESOURCE_TYPES.VirtualMachine],
  [RESOURCE_TYPES.CDN]: [RESOURCE_TYPES.ObjectStorage],
  [RESOURCE_TYPES.Firewall]: Object.values(RESOURCE_TYPES).filter(type => type !== RESOURCE_TYPES.Firewall),
  [RESOURCE_TYPES.LoadBalancer]: [RESOURCE_TYPES.VirtualMachine],
  [RESOURCE_TYPES.VirtualMachine]: [{ target: RESOURCE_TYPES.VirtualMachine, requires: "application-flow" }, { target: RESOURCE_TYPES.LoadBalancer, requires: "application-flow" }, { target: RESOURCE_TYPES.Database, requires: "application-flow/2" }, { target: RESOURCE_TYPES.Cache, requires: "application-flow/2" }, RESOURCE_TYPES.EventBus, RESOURCE_TYPES.MessageQueue, RESOURCE_TYPES.ContainerRegistry, RESOURCE_TYPES.ObjectStorage],
  [RESOURCE_TYPES.ContainerRegistry]: [RESOURCE_TYPES.ObjectStorage],
  [RESOURCE_TYPES.Cache]: [RESOURCE_TYPES.Database],
  [RESOURCE_TYPES.Database]: [],
  [RESOURCE_TYPES.MessageQueue]: [RESOURCE_TYPES.VirtualMachine], // Enabled async queue -> worker; Model 2 checks the complete binding.
  [RESOURCE_TYPES.ObjectStorage]: [], // End node, receives connections, doesn't initiate a connection
  [RESOURCE_TYPES.MonitoringAgent]: Object.values(RESOURCE_TYPES).filter(type => type !== RESOURCE_TYPES.Firewall)
} as const;

export type CONNECTION_RULES_TYPE = typeof CONNECTION_RULES;
