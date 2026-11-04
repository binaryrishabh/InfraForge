import { serverlessError } from "../resource/Serverless.interface";
import { schedulerError } from "../resource/Scheduler.interface";
import { apiGatewayError } from "../resource/ApiGateway.interface";
import { eventBusError } from "../resource/EventBus.interface";
import { lbRateLimitError } from "../resource/LbRateLimit.interface";
import { RESOURCE_TYPES, type ResourceType } from "../resource/RESOURCE_TYPES.constants";
import type { ConnectionLine } from "../resource/ConnectionLine.interface";
import type { Resource } from "../resource/Resource.interface";
import { CONNECTION_RULES } from "../topology/CONNECTION_RULES.constants";
import { computeTopology } from "../topology/computeTopology";
import { dataKeyspaceError } from "../resource/DataKeyspace.interface";
import { cachePolicyError } from "../resource/CachePolicy.interface";
import { firewallCapacityError } from "../resource/FirewallCapacity.interface";
import { objectStoragePolicyError } from "../resource/ObjectStoragePolicy.interface";
import { monitoringPolicyError } from "../resource/MonitoringPolicy.interface";
import { dnsCachePolicyError } from "../resource/DnsCachePolicy.interface";
import { cdnCachePolicyError } from "../resource/CdnCachePolicy.interface";
import { vmMemoryError } from "../resource/VmMemory.interface";
import { vmCpuQuotaError } from "../resource/VmCpuQuota.interface";
import { vmExecutionError } from "../resource/VmExecution.interface";
import { databaseReadRoutingError } from "../resource/DatabaseReadRouting.interface";
import { databaseReplicationError } from "../resource/DatabaseReplication.interface";
import { dbConcurrencyError } from "../resource/DbConcurrency.interface";
import { lbAdmissionError } from "../resource/LbAdmission.interface";
import { lbSelectionError } from "../resource/LbSelection.interface";
import { lbHealthError } from "../resource/LbHealth.interface";

// Function to validete the above defined rules
export function validateConnection(sourceType: ResourceType, targetType: ResourceType, context?: "draw" | { source: Resource; target?: Resource; connectionId: string }): { valid: boolean, message: string } {
    const allowed = CONNECTION_RULES[sourceType];
    if (!allowed) { // if the defined source type doesn't even exists.
        return { valid: false, message: "Unknown source type: " + sourceType };
    }
    if (allowed.length === 0) { // If defined source type couldn't make connection with any of the target like Object Storage
        return { valid: false, message: sourceType + " cannot connect to any resource" };
    }
    const rule = allowed.find(rule => (typeof rule === "string" ? rule : rule.target) === targetType);
    if (!rule) { // If the sepcified sourceType can't make connection with the defined targetType
        return { valid: false, message: `${sourceType} cannot connect to ${targetType}. Allowed: ${allowed.filter(rule => context === "draw" || typeof rule === "string" || rule.requires === "application-flow/2").map(rule => typeof rule === "string" ? rule : rule.target).join(", ")}` };
    }
    if (targetType === RESOURCE_TYPES.MessageQueue && context && context !== "draw" && context.target?.asyncQueue?.enabled && context.source.applicationFlow?.schema === "application-flow/3" && !Object.values(context.source.applicationFlow.operations).some(flow => flow.steps.some(step => step.kind === "publish" && step.edge === context.connectionId))) return { valid: false, message: "This upload queue needs an Application Flow publish step on the source VM" };
    if (typeof rule !== "string" && context !== "draw" && (rule.requires === "application-flow" || (context?.source.applicationFlow && context.source.applicationFlow.schema !== "application-flow/1"))) {
        const usesConnection = context && Object.values(context.source.applicationFlow?.operations ?? {}).some(flow =>
            flow.steps.some(step => step.kind === (rule.requires === "application-flow/2" ? "data" : "call") && "edge" in step ? step.edge === context.connectionId :
                rule.requires === "application-flow" && step.kind === "parallel" && step.branches.some(branch => branch.edge === context.connectionId)));
        if (!usesConnection) return { valid: false, message: "This connection is used only by an Application Flow: author a flow on the source VM that calls it" };
    }
    return { valid: true, message: "Connection valid" };
}

/* Generic canvas structure and conditional drawing rules only. The engine's
contract builder decides whether a connected design can execute. */
export function validateDeploymentReadiness(resources: Array<Resource>, connections: Array<ConnectionLine>): { valid: boolean, errors: string[], warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const resource of resources) {
        const gatewayMessage = apiGatewayError(resource.type, resource.apiGateway); if (gatewayMessage) errors.push(`${resource.id}: ${gatewayMessage}`);
        const functionMessage = serverlessError(resource.type, resource.serverless); if (functionMessage) errors.push(`${resource.id}: ${functionMessage}`);
        const schedulerMessage = schedulerError(resource.type, resource.scheduler); if (schedulerMessage) errors.push(`${resource.id}: ${schedulerMessage}`);
        const busMessage = eventBusError(resource.type, resource.eventBus); if (busMessage) errors.push(`${resource.id}: ${busMessage}`);
        const firewallMessage = firewallCapacityError(resource.type, resource.firewallCapacity);
        if (firewallMessage) errors.push(`${resource.id}: ${firewallMessage}`);
        const objectMessage = objectStoragePolicyError(resource.type, resource.objectStoragePolicy);
        if (objectMessage) errors.push(`${resource.id}: ${objectMessage}`);
        const monitoringMessage = monitoringPolicyError(resource.type, resource.monitoringPolicy);
        if (monitoringMessage) errors.push(`${resource.id}: ${monitoringMessage}`);
        const dnsMessage = dnsCachePolicyError(resource.type, resource.dnsCachePolicy);
        if (dnsMessage) errors.push(`${resource.id}: ${dnsMessage}`);
        const cdnMessage = cdnCachePolicyError(resource.type, resource.cdnCachePolicy);
        if (cdnMessage) errors.push(`${resource.id}: ${cdnMessage}`);
        const message = dataKeyspaceError(resource.type, resource.dataKeyspace);
        if (message) errors.push(`${resource.id}: ${message}`);
        const cacheMessage = cachePolicyError(resource.type, resource.cachePolicy);
        if (cacheMessage) errors.push(`${resource.id}: ${cacheMessage}`);
        const memoryMessage = vmMemoryError(resource.type, resource.vmMemory, resource.asyncWorker?.enabled);
        if (memoryMessage) errors.push(`${resource.id}: ${memoryMessage}`);
        const quotaMessage = vmCpuQuotaError(resource.type, resource.vmCpuQuota, resource.asyncWorker?.enabled);
        if (quotaMessage) errors.push(`${resource.id}: ${quotaMessage}`);
        const executionMessage = vmExecutionError(resource.type, resource.vmExecution, resource.asyncWorker?.enabled);
        if (executionMessage) errors.push(`${resource.id}: ${executionMessage}`);
        const routingMessage = databaseReadRoutingError(resource.type, resource.databaseReadRouting, resource.databaseReplication);
        if (routingMessage) errors.push(`${resource.id}: ${routingMessage}`);
        const replicationMessage = databaseReplicationError(resource.type, resource.databaseReplication);
        if (replicationMessage) errors.push(`${resource.id}: ${replicationMessage}`);
        const concurrencyMessage = dbConcurrencyError(resource.type, resource.dbConcurrency);
        if (concurrencyMessage) errors.push(`${resource.id}: ${concurrencyMessage}`);
        const rateLimitMessage = lbRateLimitError(resource.type, resource.lbRateLimit);
        if (rateLimitMessage) errors.push(`${resource.id}: ${rateLimitMessage}`);
        const admissionMessage = lbAdmissionError(resource.type, resource.lbAdmission);
        if (admissionMessage) errors.push(`${resource.id}: ${admissionMessage}`);
        const selectionMessage = lbSelectionError(resource.type, resource.lbSelection);
        if (selectionMessage) errors.push(`${resource.id}: ${selectionMessage}`);
        const healthMessage = lbHealthError(resource.type, resource.lbHealth);
        if (healthMessage) errors.push(`${resource.id}: ${healthMessage}`);
    }
    for (const line of connections) {
        const source = resources.find(resource => resource.id === line.sourceId);
        const target = resources.find(resource => resource.id === line.targetId);
        if (source?.asyncWorker?.enabled && source.asyncWorker.idempotentResults === true && target?.type === "Database") errors.push(`${source.id}: Idempotent result writes protect Object Storage only; disconnect the worker database dependency.`);
        // Existing wiring retains shipped readiness semantics. Only conditional
        // rules introduce a readiness requirement; drawing rules are separate.
        if (source && target && (CONNECTION_RULES[source.type]?.some(rule => typeof rule !== "string" && rule.target === target.type) || (source.applicationFlow?.schema === "application-flow/3" && target.type === RESOURCE_TYPES.MessageQueue && target.asyncQueue?.enabled))) {
            const verdict = validateConnection(source.type, target.type, { source, target, connectionId: line.id });
            if (!verdict.valid) errors.push(`${line.id}: ${verdict.message}`);
        }
    }
    const types = resources.map(resource => resource.type);
    if (!resources.length) errors.push("Infrastructure must contain at least one resource");
    /* ------------------GRAPH TRAVERSAL (L2)-------------------- */
    const connectedIds = new Set<string>();
    for (const line of connections) {
        if (!resources.some(resource => resource.id === line.sourceId) || !resources.some(resource => resource.id === line.targetId)) {
            errors.push(`${line.id} must connect resources that exist on the canvas`);
        }
        connectedIds.add(line.sourceId);
        connectedIds.add(line.targetId);
    }
    for (const resource of resources) {
        if (!connectedIds.has(resource.id) && !(resources.length === 1 && resource.type === RESOURCE_TYPES.VirtualMachine)) {
            errors.push(`${resource.id} is isolated — connect it or remove it`);
        }
    }
    const topology = computeTopology(resources, connections);
    for (const id of topology.idle) {
        if (connectedIds.has(id)) {
            warnings.push(`${id} is not downstream of DNS, CDN, Firewall, or Load Balancer`);
        }
    }
    for (const id of topology.deadEnds) {
        warnings.push(`${id} has no downstream connections`);
    }
    /* ----------------------------------SOFT WARNINGS do not block---------------------------- */
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
