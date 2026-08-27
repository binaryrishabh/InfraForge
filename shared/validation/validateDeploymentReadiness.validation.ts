import { RESOURCE_TYPES, type ResourceType } from "../constants/RESOURCE_TYPES.constants";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Resource } from "@shared/interface/Resource.interface";
import { CONNECTION_RULES } from "@shared/constants/CONNECTION_RULES.constants";

// Function to validete the above defined rules
export function validateConnection(sourceType: ResourceType, targetType: ResourceType): {valid: boolean, message: string} {
  const allowed = CONNECTION_RULES[sourceType];

  if(!allowed) { // if the defined source type doesn't even exists.
    return {
      valid: false,
      message: "Unknown source type: "+ sourceType
    }
  }

  if(allowed.length === 0) { // If defined source type couldn't make connection with any of the target like Object Storage
    return {
      valid: false,
      message: sourceType +" cannot connect to any resource"
    }
  }

  if(!allowed.includes(targetType)) { // If the sepcified sourceType can't make connection with the defined targetType i.e. targetType is not present in the array of the CONNECTION RULES of the source type
    return {
      valid: false,
      message: `${sourceType} cannot connect to ${targetType}. Allowed: ${allowed.join(", ")}`
    }
  }

  return {
    valid: true,
    message: "Connection valid"
  }
}


/* Checking the radiness of the current canvas resources i.e. they could be deployed or not */
/*
TODO (Phase 5): Add actual graph traversal here.
Currently checks type presence. Future: walk connection edges to verify
that specific instances are connected, not just that types exist.
 */
export function validateDeploymentReadiness(resources: Array<Resource>, connections: Array<ConnectionLine>): { valid: boolean, errors: string[], warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const types = resources.map(resource => resource.type); // Here type is resource name

  /* ------------------HARD ERRORS block deployment-------------------- */
  // Load balance needs atleast one Virtual Machine
  if(types.includes(RESOURCE_TYPES.LoadBalancer) && !types.includes(RESOURCE_TYPES.VirtualMachine)) {
    errors.push("Load balancer required at least one Virtual Machine as backend");
  }

  // CDN needs origin
  if(types.includes(RESOURCE_TYPES.CDN) && !types.includes(RESOURCE_TYPES.LoadBalancer)) {
    errors.push("CDN requires Load Balancer as origin");
  }

  // DNS needs a target
  if(types.includes(RESOURCE_TYPES.DNS) && !types.includes(RESOURCE_TYPES.CDN) && !types.includes(RESOURCE_TYPES.LoadBalancer)) {
    errors.push("DNS requires a target (CDN or Load Balancer)");
  }

  // Cache needs Database
  if(types.includes(RESOURCE_TYPES.Cache) && !types.includes(RESOURCE_TYPES.Database)) {
    errors.push("Cache requires a database to cache data from");
  }

  // Message Queue needs either Virtual Machine or Database
  if(types.includes(RESOURCE_TYPES.MessageQueue) && !types.includes(RESOURCE_TYPES.VirtualMachine) && !types.includes(RESOURCE_TYPES.Database)) {
    errors.push("Message Queue requires a consumer (Virtual Machine or Database)");
  }

  // Container Registry needs Virtual Machine
  if(types.includes(RESOURCE_TYPES.ContainerRegistry) && !types.includes(RESOURCE_TYPES.VirtualMachine)) {
    errors.push("Container Registry requires at least one Virtual Machine");
  }

  // Minimum deployable setup
  const deployableTypes: ResourceType[] = [
    RESOURCE_TYPES.VirtualMachine, 
    RESOURCE_TYPES.Database, 
    RESOURCE_TYPES.ObjectStorage
  ];
  const hasDeployable = resources.some(resource => deployableTypes.includes(resource.type));

  if(!hasDeployable) {
    errors.push("Infrastructure must contain at least one deployable resource (Virtual Machine, Database, or Object Storage)");
  }

  /* ----------------------------------SOFT WARNINGS do not block---------------------------- */
  if(types.includes(RESOURCE_TYPES.Database) && !types.includes(RESOURCE_TYPES.ObjectStorage)) {
    warnings.push("Database should have Object Storage for backup");
  }

  if(types.includes(RESOURCE_TYPES.MonitoringAgent)) {
    const monitoredTypes: ResourceType[] = [
      RESOURCE_TYPES.VirtualMachine,
      RESOURCE_TYPES.Database,
      RESOURCE_TYPES.Cache,
      RESOURCE_TYPES.MessageQueue
    ];
    const hasMonitored = types.some(type => monitoredTypes.includes(type));
    if(!hasMonitored) {
      warnings.push("Monitoring Agent has no resources to monitor");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}