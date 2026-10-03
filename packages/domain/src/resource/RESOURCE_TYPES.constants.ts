export const RESOURCE_TYPES = {
  DNS: "DNS",
  CDN: "CDN",
  Firewall: "Firewall",
  LoadBalancer: "Load Balancer",
  VirtualMachine: "Virtual Machine",
  ContainerRegistry: "Container Registry",
  Cache: "Cache",
  Database: "Database",
  ObjectStorage: "Object Storage",
  MessageQueue: "Message Queue",
  MonitoringAgent: "Monitoring Agent",
} as const;

export type ResourceType = (typeof RESOURCE_TYPES)[keyof typeof RESOURCE_TYPES];