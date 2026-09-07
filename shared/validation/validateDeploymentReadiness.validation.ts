import { RESOURCE_TYPES, type ResourceType } from "../constants/RESOURCE_TYPES.constants";
import type { ConnectionLine } from "../interface/ConnectionLine.interface";
import type { Resource } from "../interface/Resource.interface";
import { CONNECTION_RULES } from "../constants/CONNECTION_RULES.constants";
import { computeTopology } from "../simulation/topology";

// Function to validete the above defined rules
export function validateConnection(sourceType: ResourceType, targetType: ResourceType): { valid: boolean, message: string } {
    const allowed = CONNECTION_RULES[sourceType];
    if (!allowed) { // if the defined source type doesn't even exists.
        return { valid: false, message: "Unknown source type: " + sourceType };
    }
    if (allowed.length === 0) { // If defined source type couldn't make connection with any of the target like Object Storage
        return { valid: false, message: sourceType + " cannot connect to any resource" };
    }
    if (!allowed.includes(targetType)) { // If the sepcified sourceType can't make connection with the defined targetType
        return { valid: false, message: `${sourceType} cannot connect to ${targetType}. Allowed: ${allowed.join(", ")}` };
    }
    return { valid: true, message: "Connection valid" };
}

/* Readiness of the current canvas: type-presence rules PLUS real graph
traversal (Quality Backlog L2 closed). Isolated nodes are hard errors;
unreachable resources and dead-end VMs are warnings. */
export function validateDeploymentReadiness(resources: Array<Resource>, connections: Array<ConnectionLine>): { valid: boolean, errors: string[], warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const types = resources.map(resource => resource.type); // Here type is resource name
    /* ------------------HARD ERRORS block deployment-------------------- */
    if (types.includes(RESOURCE_TYPES.LoadBalancer) && !types.includes(RESOURCE_TYPES.VirtualMachine)) {
        errors.push("Load balancer required at least one Virtual Machine as backend");
    }
    if (types.includes(RESOURCE_TYPES.CDN) && !types.includes(RESOURCE_TYPES.LoadBalancer)) {
        errors.push("CDN requires Load Balancer as origin");
    }
    if (types.includes(RESOURCE_TYPES.DNS) && !types.includes(RESOURCE_TYPES.CDN) && !types.includes(RESOURCE_TYPES.LoadBalancer)) {
        errors.push("DNS requires a target (CDN or Load Balancer)");
    }
    if (types.includes(RESOURCE_TYPES.Cache) && !types.includes(RESOURCE_TYPES.Database)) {
        errors.push("Cache requires a database to cache data from");
    }
    if (types.includes(RESOURCE_TYPES.MessageQueue) && !types.includes(RESOURCE_TYPES.VirtualMachine) && !types.includes(RESOURCE_TYPES.Database)) {
        errors.push("Message Queue requires a consumer (Virtual Machine or Database)");
    }
    if (types.includes(RESOURCE_TYPES.ContainerRegistry) && !types.includes(RESOURCE_TYPES.VirtualMachine)) {
        errors.push("Container Registry requires at least one Virtual Machine");
    }
    const deployableTypes: ResourceType[] = [
        RESOURCE_TYPES.VirtualMachine,
        RESOURCE_TYPES.Database,
        RESOURCE_TYPES.ObjectStorage
    ];
    const hasDeployable = resources.some(resource => deployableTypes.includes(resource.type));
    if (!hasDeployable) {
        errors.push("Infrastructure must contain at least one deployable resource (Virtual Machine, Database, or Object Storage)");
    }
    /* ------------------GRAPH TRAVERSAL (L2)-------------------- */
    const connectedIds = new Set<string>();
    for (const line of connections) {
        connectedIds.add(line.sourceId);
        connectedIds.add(line.targetId);
    }
    for (const resource of resources) {
        if (!connectedIds.has(resource.id)) {
            errors.push(`${resource.id} is isolated — connect it or remove it`);
        }
    }
    const topology = computeTopology(resources, connections);
    for (const id of topology.idle) {
        if (connectedIds.has(id)) {
            warnings.push(`${id} cannot be reached from any entry point (DNS, CDN, Firewall, or Load Balancer)`);
        }
    }
    for (const id of topology.deadEnds) {
        warnings.push(`${id} has no downstream data path — data requests will fail`);
    }
    /* ----------------------------------SOFT WARNINGS do not block---------------------------- */
    if (types.includes(RESOURCE_TYPES.Database) && !types.includes(RESOURCE_TYPES.ObjectStorage)) {
        warnings.push("Database should have Object Storage for backup");
    }
    if (types.includes(RESOURCE_TYPES.MonitoringAgent)) {
        const monitoredTypes: ResourceType[] = [
            RESOURCE_TYPES.VirtualMachine,
            RESOURCE_TYPES.Database,
            RESOURCE_TYPES.Cache,
            RESOURCE_TYPES.MessageQueue
        ];
        const hasMonitored = types.some(type => monitoredTypes.includes(type));
        if (!hasMonitored) {
            warnings.push("Monitoring Agent has no resources to monitor");
        }
    }
    return { valid: errors.length === 0, errors, warnings };
}