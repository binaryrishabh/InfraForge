import { assumedPayloads } from "../messaging/payload";
import { API_GATEWAY_PROFILE, gatewayIntent, gatewayTemplate } from "../gateway/product";
import { apiGatewayError } from "@infraforge/domain/resource";
import { EVENT_BUS_PROFILE, eventBusIntent, eventBusTemplate } from "../eventbus/product";
import { eventBusError } from "@infraforge/domain/resource";
import { LB_RATE_LIMIT_PROFILE, lbRateLimitChanges, lbRateLimit } from "./lbRateLimit";
import { CLIENT_RETRY_PROFILE, compileClientRetry } from "./clientRetry";
import { compileObjective } from "./objective";
import { arrivalVersion, compileCpuDynamics } from "./workloadDynamics";
import type { AdapterProfile } from "@infraforge/contracts/run-inputs";
import { clientRetryError, workloadDynamicsError, workloadObjectiveError } from "@infraforge/domain/workload";
import { findSku, CATALOG_SNAPSHOT_DATE } from "@infraforge/catalog";
import { RESOURCE_PORTS, vmMemoryError, lbRateLimitError, firewallCapacityError, objectStoragePolicyError, monitoringPolicyError, cdnCachePolicyError, vmCpuQuotaError, vmExecutionError, lbSelectionError, lbHealthError, lbAdmissionError, databaseReplicationError, dbConcurrencyError, cachePolicyError, dataKeyspaceError, securitySettingsError, applicationFlowError, asyncSettingsError, circuitBreakerSettingsError, retrySettingsError, type Resource } from "@infraforge/domain/resource";
import type { Quantity, Unit } from "../../reality/quantity";
import type { ComputeResource } from "../compute/contracts";
import type { CommandConfig } from "../async/contracts";
import type { ProductContract, SavedProductDesign, Diagnostic, ResourceTemplate, EdgeContract } from "./contracts";
import { compileProduct, savedPoolPolicies } from "./compiler";
import { boundedProduct } from "./bounds";
import { canonical } from "./provenance";
import { KEYSPACE_PROFILE, HOT_KEY_PROFILE, hotKey, multiKey, asideKeyspace, databaseKeyspace } from "./keyspace";
import { FIREWALL_CAPACITY_PROFILE, changedFirewallCapacity, firewallCapacityChanges, firewallCapacity } from "./firewallCapacity";
import { OBJECT_CAPACITY_PROFILE, changedObjectCapacity, objectCapacityChanges, objectCapacity } from "./objectCapacity";
import { MONITOR_BUFFER_PROFILE, changedMonitoringBuffer, monitoringBufferChanges, monitoringBuffer } from "./monitoringBuffer";
import { MONITOR_CADENCE_PROFILE, changedMonitoringCadence, monitoringCadenceChanges, monitoringCadence } from "./monitoringCadence";
import { CDN_COALESCING_PROFILE, changedCdnCoalescing, cdnCoalescingChanges, cdnCoalescing } from "./cdnCoalescing";
import { CDN_TTL_PROFILE, cdnTtlChanges, cdnTtl } from "./cdnTtl";
import { CACHE_POLICY_PROFILE, cachePolicyChanges, changedCachePolicy, changedCacheTtl } from "./cachePolicy";
import { CACHE_CAPACITY_PROFILE, cacheCapacityChanges, changedCacheCapacity, MODELED_ROW_BYTES, MODELED_CACHE_ENTRY_OVERHEAD_BYTES } from "./cacheCapacity";
import { QUEUE_IDEMPOTENCY_PROFILE, changedQueueIdempotency, queueIdempotencyChanges, resultWritePolicy } from "./queueIdempotency";
import { QUEUE_CAPACITY_PROFILE, changedQueueCapacity, queueCapacityChanges, queueMessageCapacity } from "./queueCapacity";
import { VM_MEMORY_PROFILE, vmMemoryChanges, changedVmMemory, vmMemorySettings, bindVmMemoryProfiles } from "./vmMemory";
import { VM_CPU_QUOTA_PROFILE, vmCpuQuotaChanges, changedVmCpuQuota, vmCpuQuota } from "./vmCpuQuota";
import { VM_EXECUTION_PROFILE, vmExecutionChanges, changedVmExecution, vmWorkers, vmQueuedRequests } from "./vmExecution";
import { DATABASE_REPLICATION_PROFILE, databaseReplicationChanges, changedDatabaseReplication } from "./databaseReplication";
import { DB_CONCURRENCY_PROFILE, dbConcurrencyChanges, changedDbConcurrency } from "./dbConcurrency";
import { LB_SELECTION_PROFILE, lbSelectionChanges, changedLbSelection } from "./lbSelection";
import { LB_HEALTH_PROFILE, lbHealthChanges, changedLbHealth, lbHealthPolicy } from "./lbHealth";
import { LB_ADMISSION_PROFILE, lbAdmissionChanges, changedLbAdmission, lbAdmissionGates } from "./lbAdmission";

export interface Assumption { id: string; value: unknown; unit: string; sentence: string }
const SOURCE = "packages/simulation/src/model2/product/fromDesign.ts";
const SCOPE = "Assumed educational workload; no measured application or provider performance";
const operations = ["read", "write", "health"] as const;

// Only new captures select current implicit profiles. Historical builds use their recorded list.
export function currentAdapterProfiles(resources: SavedProductDesign["resources"], workload?: SavedProductDesign["workload"]): AdapterProfile[] {
  const dataFlow = resources.some(r => r.applicationFlow?.schema === "application-flow/2");
  const publishFlow = resources.some(r => r.applicationFlow?.schema === "application-flow/3");
  return [...(gatewayIntent(resources) ? [API_GATEWAY_PROFILE] : []), ...(eventBusIntent(resources) ? [EVENT_BUS_PROFILE] : []), ...(workload?.clientRetry ? [CLIENT_RETRY_PROFILE] : []), ...(workload?.clientRetry || dataFlow || publishFlow || resources.some(r => r.retry?.enabled || r.circuitBreaker?.enabled || r.lbRateLimit !== undefined || r.vmMemory !== undefined) ? ["failure-cause/1" as const] : []), ...(dataFlow ? ["application-flow/2" as const] : []), ...(publishFlow ? ["application-flow/3" as const] : []), ...(multiKey(resources) ? [KEYSPACE_PROFILE] : []), ...(hotKey(resources) ? [HOT_KEY_PROFILE] : []), ...(cachePolicyChanges(resources) ? [CACHE_POLICY_PROFILE] : []), ...(cacheCapacityChanges(resources) ? [CACHE_CAPACITY_PROFILE] : []), ...(databaseReplicationChanges(resources) ? [DATABASE_REPLICATION_PROFILE] : []), ...(dbConcurrencyChanges(resources) ? [DB_CONCURRENCY_PROFILE] : []), ...(vmExecutionChanges(resources) ? [VM_EXECUTION_PROFILE] : []), ...(vmMemoryChanges(resources) ? [VM_MEMORY_PROFILE] : []), ...(vmCpuQuotaChanges(resources) ? [VM_CPU_QUOTA_PROFILE] : []), ...(lbRateLimitChanges(resources) ? [LB_RATE_LIMIT_PROFILE] : []), ...(lbAdmissionChanges(resources) ? [LB_ADMISSION_PROFILE] : []), ...(lbSelectionChanges(resources) ? [LB_SELECTION_PROFILE] : []), ...(lbHealthChanges(resources) ? [LB_HEALTH_PROFILE] : []), ...(queueCapacityChanges(resources) ? [QUEUE_CAPACITY_PROFILE] : []), ...(queueIdempotencyChanges(resources) ? [QUEUE_IDEMPOTENCY_PROFILE] : []), ...(cdnTtlChanges(resources) ? [CDN_TTL_PROFILE] : []), ...(cdnCoalescingChanges(resources) ? [CDN_COALESCING_PROFILE] : []), ...(monitoringCadenceChanges(resources) ? [MONITOR_CADENCE_PROFILE] : []), ...(monitoringBufferChanges(resources) ? [MONITOR_BUFFER_PROFILE] : []), ...(objectCapacityChanges(resources) ? [OBJECT_CAPACITY_PROFILE] : []), ...(firewallCapacityChanges(resources) ? [FIREWALL_CAPACITY_PROFILE] : [])];
}

/** Canvas intent is preserved; missing application and service settings are visible assumptions.
 * Historical reconstruction may explicitly select the absent cause profile; compilation never upgrades it. */
export function contractFromDesign(saved: SavedProductDesign, history?: { failureCause: false } | { adapterProfiles: readonly AdapterProfile[] }): { contract: ProductContract; assumptions: Assumption[] } | { refused: Diagnostic[] } {
  const refused: Diagnostic[] = [];
  const error = (path: string, message: string) => refused.push({ code: "DESIGN_NOT_RUNNABLE", path, message, severity: "error" });
  try {
    boundedProduct(saved);
    const dynamicsError = workloadDynamicsError(saved.workload.workloadDynamics) ?? clientRetryError(saved.workload.clientRetry) ?? workloadObjectiveError(saved.workload.workloadObjective);
    if (dynamicsError) throw Error(dynamicsError);
    const design = savedPoolPolicies(saved), resources = [...design.resources].sort((a, b) => a.id < b.id ? -1 : 1);
    // New captures record cause evidence when saved retry, breaker, flow or limiter intent needs it.
    const profiles = history && "adapterProfiles" in history ? history.adapterProfiles : history ? [] : currentAdapterProfiles(resources, saved.workload);
    if (profiles.some(p => ![API_GATEWAY_PROFILE, EVENT_BUS_PROFILE, "traffic-evidence/2", CLIENT_RETRY_PROFILE, "failure-cause/1", "application-flow/2", "application-flow/3", KEYSPACE_PROFILE, HOT_KEY_PROFILE, CACHE_POLICY_PROFILE, CACHE_CAPACITY_PROFILE, DATABASE_REPLICATION_PROFILE, DB_CONCURRENCY_PROFILE, VM_EXECUTION_PROFILE, VM_MEMORY_PROFILE, VM_CPU_QUOTA_PROFILE, LB_RATE_LIMIT_PROFILE, LB_ADMISSION_PROFILE, LB_SELECTION_PROFILE, LB_HEALTH_PROFILE, QUEUE_CAPACITY_PROFILE, QUEUE_IDEMPOTENCY_PROFILE, CDN_TTL_PROFILE, CDN_COALESCING_PROFILE, MONITOR_CADENCE_PROFILE, MONITOR_BUFFER_PROFILE, OBJECT_CAPACITY_PROFILE, FIREWALL_CAPACITY_PROFILE].includes(p)) || new Set(profiles).size !== profiles.length) error("adapterProfiles", "Unsupported adapter profile selection.");
    if (eventBusIntent(resources) !== profiles.includes(EVENT_BUS_PROFILE)) error("adapterProfiles", "Event Bus requires captured event-bus/1 and matching saved intent.");
    if (gatewayIntent(resources) !== profiles.includes(API_GATEWAY_PROFILE)) error("adapterProfiles", "Gateway requires captured api-gateway/1 and matching saved intent.");
    const failureCause = profiles.includes("failure-cause/1");
    if (!!saved.workload.clientRetry !== profiles.includes(CLIENT_RETRY_PROFILE) || (saved.workload.clientRetry && !failureCause)) error("adapterProfiles", "Client retries require captured client-retry/1 and failure-cause/1 with matching saved intent; reads only.");
    const hasKeyspace = multiKey(resources);
    if (hasKeyspace !== profiles.includes(KEYSPACE_PROFILE)) error("adapterProfiles", "Multi-key intent requires its captured data-keyspace/1 adapter profile and matching saved intent.");
    const hasHotKey = hotKey(resources);
    if (hasHotKey !== profiles.includes(HOT_KEY_PROFILE)) error("adapterProfiles", "Hot-key intent requires its captured data-hot-key/1 adapter profile and matching saved intent.");
    const hasFirewallCapacity = firewallCapacityChanges(resources);
    if (hasFirewallCapacity !== profiles.includes(FIREWALL_CAPACITY_PROFILE)) error("adapterProfiles", "Firewall capacity requires its captured firewall-flow-capacity/1 adapter profile and matching saved intent.");
    const hasObjectCapacity = objectCapacityChanges(resources);
    if (hasObjectCapacity !== profiles.includes(OBJECT_CAPACITY_PROFILE)) error("adapterProfiles", "Object capacity requires its captured object-capacity/1 adapter profile and matching saved intent.");
    const hasMonitoringBuffer = monitoringBufferChanges(resources);
    if (hasMonitoringBuffer !== profiles.includes(MONITOR_BUFFER_PROFILE)) error("adapterProfiles", "Monitoring buffer requires its captured monitor-buffer/1 adapter profile and matching saved intent.");
    const hasMonitoringCadence = monitoringCadenceChanges(resources);
    if (hasMonitoringCadence !== profiles.includes(MONITOR_CADENCE_PROFILE)) error("adapterProfiles", "Monitoring cadence requires its captured monitor-cadence/1 adapter profile and matching saved intent.");
    const hasCdnCoalescing = cdnCoalescingChanges(resources);
    if (hasCdnCoalescing !== profiles.includes(CDN_COALESCING_PROFILE)) error("adapterProfiles", "CDN coalescing requires its captured cdn-coalescing/1 adapter profile and matching saved intent.");
    const hasCdnTtl = cdnTtlChanges(resources);
    if (hasCdnTtl !== profiles.includes(CDN_TTL_PROFILE)) error("adapterProfiles", "CDN TTL requires its captured cdn-ttl/1 adapter profile and matching saved intent.");
    const hasCachePolicy = cachePolicyChanges(resources);
    if (hasCachePolicy !== profiles.includes(CACHE_POLICY_PROFILE)) error("adapterProfiles", "Changed cache intent requires its captured data-cache-policy/1 adapter profile and matching saved intent.");
    const hasCacheCapacity = cacheCapacityChanges(resources);
    if (hasCacheCapacity !== profiles.includes(CACHE_CAPACITY_PROFILE)) error("adapterProfiles", "Logical cache capacity requires its captured data-cache-capacity/1 adapter profile and matching saved intent.");
    const hasVmMemory = vmMemoryChanges(resources);
    if (hasVmMemory !== profiles.includes(VM_MEMORY_PROFILE) || (hasVmMemory && !failureCause)) error("adapterProfiles", "Modeled memory requires its captured vm-memory/1 adapter profile and matching saved intent.");
    const hasVmCpuQuota = vmCpuQuotaChanges(resources);
    if (hasVmCpuQuota !== profiles.includes(VM_CPU_QUOTA_PROFILE)) error("adapterProfiles", "Application CPU quota requires its captured vm-cpu-quota/1 adapter profile and matching saved intent.");
    const hasVmExecution = vmExecutionChanges(resources);
    if (hasVmExecution !== profiles.includes(VM_EXECUTION_PROFILE)) error("adapterProfiles", "VM execution requires its captured vm-execution/1 adapter profile and matching saved intent.");
    const hasDatabaseReplication = databaseReplicationChanges(resources);
    if (hasDatabaseReplication !== profiles.includes(DATABASE_REPLICATION_PROFILE)) error("adapterProfiles", "Database replication requires its captured db-replication/1 profile and matching saved intent.");
    const hasDbConcurrency = dbConcurrencyChanges(resources);
    if (hasDbConcurrency !== profiles.includes(DB_CONCURRENCY_PROFILE)) error("adapterProfiles", "Database concurrency requires its captured data-db-concurrency/1 adapter profile and matching saved intent.");
    const hasQueueIdempotency = queueIdempotencyChanges(resources);
    if (hasQueueIdempotency !== profiles.includes(QUEUE_IDEMPOTENCY_PROFILE)) error("adapterProfiles", "Idempotent result writes require the captured queue-idempotency/1 adapter profile and matching saved intent.");
    const hasQueueCapacity = queueCapacityChanges(resources);
    if (hasQueueCapacity !== profiles.includes(QUEUE_CAPACITY_PROFILE)) error("adapterProfiles", "Queue capacity requires its captured queue-capacity/1 adapter profile and matching saved intent.");
    const hasLbSelection = lbSelectionChanges(resources);
    if (hasLbSelection !== profiles.includes(LB_SELECTION_PROFILE)) error("adapterProfiles", "Load balancer selection requires its captured lb-selection/1 profile and matching saved intent.");
    const hasLbHealth = lbHealthChanges(resources);
    if (hasLbHealth !== profiles.includes(LB_HEALTH_PROFILE)) error("adapterProfiles", "Load balancer health requires its captured lb-health/1 adapter profile and matching saved intent.");
    const hasLbRateLimit = lbRateLimitChanges(resources);
    if (hasLbRateLimit !== profiles.includes(LB_RATE_LIMIT_PROFILE) || (hasLbRateLimit && !failureCause)) error("adapterProfiles", "Load balancer rate limit requires its captured lb-rate-limit/1 and failure-cause/1 profiles with matching saved intent.");
    const hasLbAdmission = lbAdmissionChanges(resources);
    if (hasLbAdmission !== profiles.includes(LB_ADMISSION_PROFILE)) error("adapterProfiles", "Load balancer admission requires its captured lb-admission/1 adapter profile and matching saved intent.");
    const hasSecurity = resources.some(r => r.listenerSettings !== undefined || r.firewallSettings !== undefined || r.firewallCapacity !== undefined);
    const hasFlow = resources.some(r => r.applicationFlow !== undefined);
    const flow2 = resources.some(r => r.applicationFlow?.schema === "application-flow/2");
    if (flow2 !== profiles.includes("application-flow/2")) error("adapterProfiles", "Application Flow /2 requires its captured application-flow/2 adapter profile and matching saved intent.");
    const flow3 = resources.some(r => r.applicationFlow?.schema === "application-flow/3");
    if (flow3 !== profiles.includes("application-flow/3")) error("adapterProfiles", "Application Flow /3 requires its captured application-flow/3 adapter profile and matching saved intent.");
    const flowProfile = flow3 ? "application-flow/3" as const : flow2 ? "application-flow/2" as const : "application-flow/1" as const;
    const byId = new Map(resources.map((r) => [r.id, r]));
    const connections = [...design.connections].sort((a, b) => a.id < b.id ? -1 : 1);
    const outgoing = (id: string) => connections.filter((e) => e.sourceId === id).map((e) => byId.get(e.targetId)!);
    const incoming = (id: string) => connections.filter((e) => e.targetId === id).map((e) => byId.get(e.sourceId)!);
    if (!resources.length) error("resources", "Add an app server or a CDN before running this empty canvas.");
    if (resources.some((r) => !/^[a-zA-Z0-9_-]{1,64}$/.test(r.id)) || byId.size !== resources.length) error("resources", "Give every resource a unique ID containing only letters, numbers, dashes or underscores.");
    for (const e of connections) if (!byId.has(e.sourceId) || !byId.has(e.targetId) || e.sourceId === e.targetId) error(`connections.${e.id}`, "Connect two different resources that both exist on the canvas.");
    if (refused.length) return { refused };
    for (const r of resources) {
      const gatewayError = apiGatewayError(r.type, r.apiGateway); if (gatewayError) error("resources." + r.id + ".apiGateway", gatewayError);
      const busError = eventBusError(r.type, r.eventBus); if (busError) error(`resources.${r.id}.eventBus`, busError);
      const firewallError = firewallCapacityError(r.type, r.firewallCapacity);
      if (firewallError) error(`resources.${r.id}.firewallCapacity`, firewallError);
      const objectError = objectStoragePolicyError(r.type, r.objectStoragePolicy);
      if (objectError) error(`resources.${r.id}.objectStoragePolicy`, objectError);
      const monitoringError = monitoringPolicyError(r.type, r.monitoringPolicy);
      if (monitoringError) error(`resources.${r.id}.monitoringPolicy`, monitoringError);
      const cdnError = cdnCachePolicyError(r.type, r.cdnCachePolicy);
      if (cdnError) error(`resources.${r.id}.cdnCachePolicy`, cdnError);
      const selectionError = lbSelectionError(r.type, r.lbSelection);
      if (selectionError) error(`resources.${r.id}.lbSelection`, selectionError);
      const healthError = lbHealthError(r.type, r.lbHealth);
      if (healthError) error(`resources.${r.id}.lbHealth`, healthError);
      const rateLimitError = lbRateLimitError(r.type, r.lbRateLimit);
      if (rateLimitError) error(`resources.${r.id}.lbRateLimit`, rateLimitError);
      const lbError = lbAdmissionError(r.type, r.lbAdmission);
      if (lbError) error(`resources.${r.id}.lbAdmission`, lbError);
      const memoryError = vmMemoryError(r.type, r.vmMemory, r.asyncWorker?.enabled);
      if (memoryError) error(`resources.${r.id}.vmMemory`, memoryError);
      const quotaError = vmCpuQuotaError(r.type, r.vmCpuQuota, r.asyncWorker?.enabled);
      if (quotaError) error(`resources.${r.id}.vmCpuQuota`, quotaError);
      const executionError = vmExecutionError(r.type, r.vmExecution, r.asyncWorker?.enabled);
      if (executionError) error(`resources.${r.id}.vmExecution`, executionError);
      const replicationError = databaseReplicationError(r.type, r.databaseReplication);
      if (replicationError) error(`resources.${r.id}.databaseReplication`, replicationError);
      const dbError = dbConcurrencyError(r.type, r.dbConcurrency);
      if (dbError) error(`resources.${r.id}.dbConcurrency`, dbError);
      const cacheError = cachePolicyError(r.type, r.cachePolicy);
      if (cacheError) error(`resources.${r.id}.cachePolicy`, cacheError);
      const keyspaceError = dataKeyspaceError(r.type, r.dataKeyspace);
      if (keyspaceError) error(`resources.${r.id}.dataKeyspace`, keyspaceError);
      const securityError = securitySettingsError(r.type, r.listenerSettings, r.firewallSettings, resources);
      if (securityError) error(`resources.${r.id}.security`, securityError);
      const flowError = applicationFlowError(r.type, r.applicationFlow);
      if (flowError) error(`resources.${r.id}.applicationFlow`, flowError);
      if (r.applicationFlow && (r.asyncWorker?.enabled || outgoing(r.id).some(t => !(r.applicationFlow?.schema === "application-flow/3" ? ["Virtual Machine", "Load Balancer", "Database", "Cache", "Message Queue", "Event Bus", "Object Storage"] : r.applicationFlow?.schema === "application-flow/2" ? ["Virtual Machine", "Load Balancer", "Database", "Cache"] : ["Virtual Machine", "Load Balancer"]).includes(t.type)))) error(`resources.${r.id}.applicationFlow`, "Flow v1 calls connected VM or load balancer services only; async/data/publish bindings are unsupported.");
      const asyncError = asyncSettingsError(r.type, r.asyncQueue, r.asyncWorker);
      if (asyncError) error(`resources.${r.id}.async`, asyncError);
      const breakerError = circuitBreakerSettingsError(r.type, r.circuitBreaker);
      if (breakerError) error(`resources.${r.id}.circuitBreaker`, breakerError);
      const retryError = retrySettingsError(r.type, r.retry);
      if (retryError) error(`resources.${r.id}.retry`, retryError);
      if (!(r.type in RESOURCE_PORTS)) error(`resources.${r.id}`, "This resource type has no Model 2 profile.");
      if (r.skuId && findSku(r.skuId)?.category !== r.type) error(`resources.${r.id}.skuId`, "Choose a catalog size belonging to this resource type.");
      if (r.type === "Database" && !incoming(r.id).some((s) => ["Virtual Machine", "Cache"].includes(s.type))) error(`resources.${r.id}`, "Connect an app server or a cache to this database so something can call it.");
      if (r.type === "Load Balancer" && (!outgoing(r.id).length || outgoing(r.id).some((t) => t.type !== "Virtual Machine"))) error(`resources.${r.id}`, "Connect the load balancer to at least one app server.");
      if (["CDN", "Container Registry", "DNS"].includes(r.type) && outgoing(r.id).length !== 1) error(`resources.${r.id}`, "Connect this resource to exactly one object store or entry point as appropriate.");
      if (r.type === "Cache" && (outgoing(r.id).length > 1 || (!outgoing(r.id).length && !incoming(r.id).some((s) => s.type === "Virtual Machine" && outgoing(s.id).some((t) => t.type === "Database"))))) error(`resources.${r.id}`, "Connect the cache to one database, or connect both the cache and a database to its app server.");
      if (r.type === "Monitoring Agent" && !outgoing(r.id).length) error(`resources.${r.id}`, "Connect the monitoring agent to a resource to observe.");
      if (r.autoscaling?.enabled && (r.type !== "Virtual Machine" || incoming(r.id).filter((s) => s.type === "Load Balancer").length !== 1)) error(`resources.${r.id}.autoscaling`, "Autoscaling needs an app server behind exactly one load balancer.");
    }
    for (const bus of resources.filter(r => r.type === "Event Bus")) {
      if (incoming(bus.id).length !== 1 || incoming(bus.id)[0]?.type !== "Virtual Machine" || incoming(bus.id)[0]?.asyncWorker?.enabled || !outgoing(bus.id).length || outgoing(bus.id).some(r => r.type !== "Message Queue" || !r.asyncQueue?.enabled)) error("resources." + bus.id, "Connect one app publisher to Event Bus and 1 to 16 enabled queues to workers.");
    }
    const asyncQueues = resources.filter((r) => r.asyncQueue?.enabled);
    const producerQueue = (id: string) => outgoing(id).find((r) => r.asyncQueue?.enabled || r.type === "Event Bus");
    for (const queue of asyncQueues) {
      const producers = incoming(queue.id).flatMap(r => r.type === "Event Bus" ? incoming(r.id) : [r]).filter((r) => r.type === "Virtual Machine" && !r.asyncWorker?.enabled);
      const workers = outgoing(queue.id).filter((r) => r.asyncWorker?.enabled);
      if (producers.length !== 1 || workers.length !== 1) error(`resources.${queue.id}`, "Connect one app producer to this queue and draw this queue to one enabled worker VM.");
      for (const producer of producers) if (outgoing(producer.id).filter((r) => r.type === "Message Queue" || r.type === "Event Bus").length !== 1) error(`resources.${producer.id}`, "Connect this producer to exactly one queue.");
      for (const node of [...producers, ...workers]) {
        if (outgoing(node.id).filter((r) => r.type === "Object Storage").length !== 1) error(`resources.${node.id}`, "Connect exactly one Object Storage to this producer or worker for uploads and results.");
        if (outgoing(node.id).some((r) => ["Database", "Cache"].includes(r.type)) || node.autoscaling?.enabled) error(`resources.${node.id}`, "This upload journey supports fixed producer and worker VMs without a database or cache dependency.");
      }
      if (producers[0] && workers[0] && outgoing(producers[0].id).find((r) => r.type === "Object Storage")?.id !== outgoing(workers[0].id).find((r) => r.type === "Object Storage")?.id) error(`resources.${queue.id}`, "Connect producer and worker to the same Object Storage so the worker can read uploads.");
    }
    for (const worker of resources.filter((r) => r.asyncWorker?.enabled)) if (incoming(worker.id).filter((r) => r.asyncQueue?.enabled).length !== 1) error(`resources.${worker.id}`, "Connect one enabled queue to this worker VM.");
    const entries = resources.filter((r) => !r.asyncWorker?.enabled && ["API Gateway", "Load Balancer", "CDN", "Virtual Machine"].includes(r.type) && !incoming(r.id).some((s) => ["API Gateway", "Load Balancer", "Virtual Machine", "CDN"].includes(s.type)));
    for (const queue of asyncQueues) if (incoming(queue.id).some((r) => r.type === "Virtual Machine" && r.id !== entries[0]?.id)) error(`resources.${queue.id}`, "This upload journey needs the producer app as the single client entry point; load balancer health polling is not an upload arrival.");
    if (entries.length !== 1) error("caller.entry", "Connect the design into one entry point: one load balancer, CDN or app server.");
    const connected = new Set<string>(), visit = (id: string): void => { if (connected.has(id)) return; connected.add(id); for (const r of [...outgoing(id), ...incoming(id)]) visit(r.id); };
    if (entries[0]) visit(entries[0].id);
    for (const r of resources) if (!connected.has(r.id)) error(`resources.${r.id}`, "Connect this resource to the application's graph before running it.");
    if (refused.length) return { refused };
    const entry = entries[0]!, assumptions: Assumption[] = [], ledger: ProductContract["ledger"] = [];
    const note = <T>(id: string, value: T, unit: string, sentence: string): T => { assumptions.push({ id, value, unit, sentence }); return value; };
    const q = <U extends Unit>(id: string, value: number, unit: U, sentence = `The assumed ${id.replaceAll(".", " ")} is ${value} ${unit}.`, chosen = false): Quantity<U> => {
      const quantity: Quantity<U> = { kind: "known", value, unit, provenance: [id] };
      if (!chosen) note(id, value, unit, sentence);
      ledger.push({ id, concept: id, modelVersion: "2", scope: SCOPE, validityDomain: SCOPE, quantity, formula: String(value), classification: chosen ? "user-input" : "educational-assumption", confidence: "conditional", provenance: [{ source: chosen ? `saved-design:${id}` : SOURCE, supports: "implementation", detail: sentence }], assumptions: [chosen ? "Saved setting only; no physical accuracy claim." : sentence], researchedOn: "2026-10-27", freeMode: "forbidden", replacement: "Replace with measured application settings before claiming physical accuracy." });
      return quantity;
    };
    const nodes: ProductContract["nodes"] = Object.create(null), edges: ProductContract["edges"] = Object.create(null);
    const capabilities: ProductContract["capabilities"] = [];
    const cores = new Map<string, number>(), memory = new Map<string, number>();
    for (const r of resources) {
      const sku = r.skuId ? findSku(r.skuId)! : undefined, scale = { small: 1, medium: 2, large: 4 }[r.size ?? "small"];
      cores.set(r.id, sku?.vCpu ?? scale); memory.set(r.id, sku?.ramGb ?? scale * 2);
      note(`${r.id}.sizing`, { cores: cores.get(r.id), memoryGb: memory.get(r.id) }, "profile", sku ? "Catalog CPU and memory labels size this assumed profile; they do not establish effective capacity." : "Small, medium and large assume one, two and four cores with two GB per core; an omitted size uses small.");
      if (sku) {
        // Advertised CPU counts only; execution capacity below remains an explicit assumption.
        const source = sku.provider === "aws" ? sku.category === "Database" ? "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.Summary.html" : `https://docs.aws.amazon.com/ec2/latest/instancetypes/${sku.skuId.startsWith("c") ? "co" : sku.skuId.startsWith("r") ? "mo" : "gp"}.html` : sku.category === "Database" ? "https://www.digitalocean.com/pricing/managed-databases" : "https://www.digitalocean.com/pricing/droplets";
        const id = `${r.id}.catalog.vCpu`, value = q(id, sku.vCpu, "count", "The selected catalog advertises this vCPU count; effective CPU remains assumed.", true), fact = ledger.at(-1)!;
        Object.assign(fact, { concept: `${sku.skuId} vCpu`, scope: `${sku.skuId} advertised vCPU only`, classification: "provider-fact", provenance: [{ source, supports: "exact", detail: "Advertised vCPU count, excluding credits, price, timing and effective CPU." }] });
        capabilities.push({ resource: r.id, sku: sku.skuId, catalogVersion: CATALOG_SNAPSHOT_DATE, field: "vCpu", value, fact: id });
      }
    }
    const execution = (r: Resource, role: string): ComputeResource => {
      const id = `${r.id}.${role}`;
      return { id, kind: "compute", cores: q(`${id}.cores`, cores.get(r.id)!, "cores"), ...vmCpuQuota(r, role, cores.get(r.id)!, q, ledger), workers: vmWorkers(r, role, cores.get(r.id)!, q), scheduler: "capped-equal-fluid/1", queueCapacity: vmQueuedRequests(r, role, q), profiles: Object.fromEntries(operations.map((o) => [o, `canvas.${o}`])), context: { labels: { environment: "canvas-assumptions" }, quantities: {} }, cancellation: "cooperative", memory: { coverage: "partial", policy: "observe" }, ...vmMemorySettings(r, role, q) };
    };
    const command = (r: Resource, role: string, names: string[]): CommandConfig => {
      const id = `${r.id}.${role}`;
      return { execution: execution(r, role), concurrency: q(`${id}.concurrency`, 16, "count"), pending: q(`${id}.pending`, 256, "count"), timeout: q(`${id}.timeout`, 1000000, "us"), demands: Object.fromEntries(names.map((n) => [n, { cpu: q(`${id}.${n}.cpu`, 100, "cpu-us"), wait: q(`${id}.${n}.wait`, 0, "us") }])) };
    };
    const gatewayPayloads = gatewayIntent(resources) ? assumedPayloads(q) : undefined;
    const security = (r: Resource, port: number, id: string, chosen = false) => ({ port: q(`${id}.port`, port, "count", "The connection uses this listening port.", chosen), protocol: "tcp" as const, firewalls: incoming(r.id).filter((s) => s.type === "Firewall").map((s) => s.id), tls: { mode: "plaintext" as const, trustedIssuers: [] } });
    const edge = (r: Resource, id: string, sourceRole: string, targetRole = "main", purpose: EdgeContract["purpose"] = "dependency", port = RESOURCE_PORTS[r.type], chosen = false): EdgeContract => ({ purpose, sourceRole, targetRole, transport: r.type === "Database" ? "database" : r.type === "Cache" ? "cache" : "assumed", request: ["request"], response: ["response"], security: security(r, port, id, chosen) });
    // A call between roles inside one resource is not a network flow, so no firewall applies to it.
    const internal = (r: Resource, sourceRole: string, targetRole: string, purpose: EdgeContract["purpose"] = "dependency") => { const e = edge(r, `${r.id}.internal.${sourceRole}-${targetRole}`, sourceRole, targetRole, purpose); nodes[r.id]!.internalEdges.push({ id: `${sourceRole}-${targetRole}`, ...e, security: { ...e.security!, firewalls: [] } }); };
    const add = (r: Resource, role: string, config: ResourceTemplate) => nodes[r.id]!.resources.push({ role, config });
    for (const r of resources) nodes[r.id] = { type: r.type, profileVersion: "canvas-assumptions/2", provenance: [SOURCE], primary: "main", securityReplacement: "explicit-reviewed/1", resources: [], internalEdges: [], identities: [], listeners: [] };
    for (const r of resources.filter(r => (r.dataKeyspace?.count ?? 1) > 1)) {
      const hot = hotKey([r]);
      nodes[r.id]!.profileVersion += `/${KEYSPACE_PROFILE}` + (hot ? `/${HOT_KEY_PROFILE}` : "");
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.dataKeyspace`);
      q(`${r.id}.dataKeyspace.count`, r.dataKeyspace!.count, "count", hot ? "Saved finite application working set; the first key receives about 80% of accesses and the rest share the remaining accesses deterministically." : "Saved finite application working set; stable synthetic keys use deterministic uniform access.", true);
    }
    for (const r of resources.filter((r) => r.asyncQueue?.enabled || r.asyncWorker?.enabled || producerQueue(r.id))) {
      nodes[r.id]!.profileVersion += "/canvas-async/1";
      nodes[r.id]!.provenance.push(r.asyncQueue?.enabled ? `saved-design:${r.id}.asyncQueue.enabled` : r.asyncWorker?.enabled ? `saved-design:${r.id}.asyncWorker.enabled` : `saved-design:connections:${r.id}`);
    }
    for (const r of resources.filter(changedQueueIdempotency)) {
      nodes[r.id]!.profileVersion += `/${QUEUE_IDEMPOTENCY_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.asyncWorker.idempotentResults`);
    }
    for (const r of resources.filter(changedQueueCapacity)) {
      nodes[r.id]!.profileVersion += `/${QUEUE_CAPACITY_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.asyncQueue.capacityMessages`);
    }
    for (const r of resources.filter(r => r.cdnCachePolicy?.ttlSeconds !== undefined)) {
      nodes[r.id]!.profileVersion += `/${CDN_TTL_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.cdnCachePolicy.ttlSeconds`);
    }
    for (const r of resources.filter(changedFirewallCapacity)) {
      nodes[r.id]!.profileVersion += `/${FIREWALL_CAPACITY_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.firewallCapacity`);
    }
    for (const r of resources.filter(changedObjectCapacity)) {
      nodes[r.id]!.profileVersion += `/${OBJECT_CAPACITY_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.objectStoragePolicy`);
    }
    for (const r of resources.filter(changedMonitoringBuffer)) {
      nodes[r.id]!.profileVersion += `/${MONITOR_BUFFER_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.monitoringPolicy`);
    }
    for (const r of resources.filter(changedMonitoringCadence)) {
      nodes[r.id]!.profileVersion += `/${MONITOR_CADENCE_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.monitoringPolicy`);
    }
    for (const r of resources.filter(changedCdnCoalescing)) {
      nodes[r.id]!.profileVersion += `/${CDN_COALESCING_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.cdnCachePolicy`);
    }
    for (const r of resources.filter(changedCachePolicy)) {
      nodes[r.id]!.profileVersion += `/${CACHE_POLICY_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.cachePolicy`);
    }
    for (const r of resources.filter(changedCacheCapacity)) {
      nodes[r.id]!.profileVersion += `/${CACHE_CAPACITY_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.cachePolicy.capacityEntries`);
    }
    for (const r of resources.filter(changedVmCpuQuota)) {
      nodes[r.id]!.profileVersion += `/${VM_CPU_QUOTA_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.vmCpuQuota`);
    }
    for (const r of resources.filter(changedVmExecution)) {
      nodes[r.id]!.profileVersion += `/${VM_EXECUTION_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.vmExecution`);
    }
    for (const r of resources.filter(changedDatabaseReplication)) {
      nodes[r.id]!.profileVersion += `/${DATABASE_REPLICATION_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.databaseReplication`);
    }
    for (const r of resources.filter(changedDbConcurrency)) {
      nodes[r.id]!.profileVersion += `/${DB_CONCURRENCY_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.dbConcurrency`);
    }
    for (const r of resources.filter(changedLbAdmission)) {
      nodes[r.id]!.profileVersion += `/${LB_ADMISSION_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.lbAdmission`);
    }
    for (const r of resources.filter(changedLbSelection)) {
      nodes[r.id]!.profileVersion += `/${LB_SELECTION_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.lbSelection`);
    }
    for (const r of resources.filter(changedLbHealth)) {
      nodes[r.id]!.profileVersion += `/${LB_HEALTH_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.lbHealth`);
    }
    const cacheCapacity = (r: Resource) => {
      if (r.cachePolicy?.version !== 2) return q(`${r.id}.capacity`, memory.get(r.id)! * 1073741824, "bytes");
      const entries = r.cachePolicy.capacityEntries;
      q(`${r.id}.cachePolicy.capacityEntries`, entries, "count", "Saved educational logical entry capacity; no provider memory claim.", true);
      const sentence = `Logical cache budget: ${entries} entries * (${MODELED_ROW_BYTES} modeled row bytes + ${MODELED_CACHE_ENTRY_OVERHEAD_BYTES} per-entry overhead bytes); excludes process and provider memory.`;
      const capacity = q(`${r.id}.capacity`, entries * (MODELED_ROW_BYTES + MODELED_CACHE_ENTRY_OVERHEAD_BYTES), "bytes", sentence, true);
      Object.assign(ledger.at(-1)!, { classification: "derived", formula: `${entries} * (${MODELED_ROW_BYTES} + ${MODELED_CACHE_ENTRY_OVERHEAD_BYTES})`, provenance: [{ source: `saved-design:${r.id}.cachePolicy.capacityEntries`, supports: "implementation", detail: sentence }, { source: SOURCE, supports: "implementation", detail: "Modeled row size and per-entry overhead from this adapter." }] });
      return capacity;
    };
    const singleFlight = (owner: string, cache: Resource) => cache.cachePolicy?.singleFlight === true
      ? true
      : note(`${owner}.cache.singleFlight`, false, "policy", "Plain cache-aside has no single-flight: concurrent misses independently call the database.");
    for (const r of resources.filter(r => r.lbRateLimit !== undefined)) {
      nodes[r.id]!.profileVersion += `/${LB_RATE_LIMIT_PROFILE}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.lbRateLimit`);
    }
    const objects = (r: Resource, role: string) => add(r, role, { kind: "object-store", profile: "atomic-current-object/1", ...command(r, role, ["put", "get", "head", "delete"]), capacity: objectCapacity(r, role, memory.get(r.id)!, q, ledger), initial: [{ namespace: "web", key: "asset", generation: 1, bytes: q(`${r.id}.${role}.asset`, 1024, "bytes"), content: "assumed-asset" }] });
    const commands: ProductContract["commands"] = [];
    for (const r of resources) {
      const id = r.id, n = nodes[id]!, target = outgoing(id)[0];
      switch (r.type) {
        case "Virtual Machine": {
          if (r.asyncWorker?.enabled) {
            const p = r.asyncWorker, broker = incoming(id).find((r) => r.asyncQueue?.enabled)!, store = outgoing(id).find((r) => r.type === "Object Storage")!;
            if (p.badJobPercent !== undefined) n.asyncBadJobPercent = q(`${id}.asyncWorker.badJobPercent`, p.badJobPercent, "percent", "Saved share selected by seed and upload identity; poison fails after read and CPU, then immediately nacks.", true);
            add(r, "main", { kind: "async-worker", execution: execution(r, "main"), broker: `$${broker.id}`, store: `$${store.id}`, databaseOperation: "read", databaseKey: "key", namespace: "results", concurrency: q(`${id}.asyncWorker.concurrency`, p.concurrency!, "count", "Saved parallel jobs limit.", true), prefetch: q(`${id}.asyncWorker.prefetch`, p.prefetch!, "count", "Saved worker prefetch credit.", true), cpu: q(`${id}.asyncWorker.cpuMsPerJob`, p.cpuMsPerJob! * 1000, "cpu-us", "Authored assumption: saved CPU milliseconds per job converted to CPU microseconds.", true), pollInterval: q(`${id}.async.poll`, 10000, "us"), blockingWait: q(`${id}.async.wait`, 0, "us"), ackDelay: q(`${id}.async.ack`, 0, "us"), resultBytes: q(`${id}.async.resultBytes`, 1024, "bytes"), idempotency: resultWritePolicy(r), poisonKeys: [] });
            break;
          }
          const queue = producerQueue(id);
          if (queue) {
            const store = outgoing(id).find((r) => r.type === "Object Storage")!;
            const config = execution(r, "main"); if (r.applicationFlow?.schema !== "application-flow/3") config.downstream = "$self/publisher"; add(r, "main", config);
            add(r, "publisher", { kind: "async-publisher", execution: execution(r, "publisher"), broker: `$${queue.id}`, store: `$${store.id}`, namespace: "uploads", objectBytes: q(`${id}.async.objectBytes`, 1024, "bytes"), messageBytes: q(`${id}.async.messageBytes`, 128, "bytes"), delay: q(`${id}.async.delay`, 0, "us"), publishAttempts: q(`${id}.async.attempts`, 1, "count") });
            internal(r, "main", "publisher"); break;
          }
          const data = outgoing(id).filter((t) => ["Database", "Cache"].includes(t.type));
          const cache = data.find((t) => t.type === "Cache"), database = data.find((t) => t.type === "Database");
          if (r.applicationFlow && r.applicationFlow.schema !== "application-flow/1") {
            if (data.filter(t => t.type === "Database").length > 1 || data.filter(t => t.type === "Cache").length > 1 || (cache && (outgoing(cache.id).length !== 1 || outgoing(cache.id)[0]?.type !== "Database" || (database && outgoing(cache.id)[0]?.id !== database.id)))) { error(`resources.${id}`, "Flow /2 supports one attached database and one optional cache drawn to that same database."); break; }
          }
          else if (data.length > 1 && !(data.length === 2 && cache && database && !outgoing(cache.id).length)) { error(`resources.${id}`, "Connect the app to one database, one database-backed cache, or one cache and one database; other combinations need an authored operation plan."); break; }
          const config = execution(r, "main");
          if (!changedVmMemory(r)) config.memory.limit = q(`${id}.memory.limit`, memory.get(id)! * 1073741824, "bytes", "The memory label is interpreted as GiB for this partial observation only; total memory use remains unknown.");
          if (r.applicationFlow && r.applicationFlow.schema !== "application-flow/1") { /* The authored steps own every data dependency. */ }
          else if (cache && database) {
            config.downstream = "$self/aside";
            add(r, "aside", { kind: "cache-aside", execution: execution(r, "aside"), cache: `$${cache.id}`, database: `$${database.id}`, ...asideKeyspace(database), coalesce: singleFlight(id, cache), onCacheFailure: "database", invalidateWrites: true, operations: { read: "read", write: "write", health: "read" } }); internal(r, "main", "aside");
          } else if (data[0]) config.downstream = `$${data[0].id}${data[0].type === "Cache" ? "/aside" : ""}`;
          add(r, "main", config); break;
        }
        case "API Gateway": n.profileVersion += "/" + API_GATEWAY_PROFILE; add(r, "main", gatewayTemplate(r, connections, command(r, "main", ["route"]), q, gatewayPayloads![design.workload.payloadSize])); break;
        case "Event Bus": n.profileVersion += "/" + EVENT_BUS_PROFILE; add(r, "main", eventBusTemplate(r, connections, command(r, "main", ["publish"]), q)); break;
        case "Load Balancer": add(r, "main", { kind: "load-balancer", backends: [], policy: r.lbSelection?.policy ?? note(`${id}.policy`, "round-robin" as const, "policy", "The load balancer sends requests to its app servers in turn (round robin), the default of common cloud load balancers."), ...lbAdmissionGates(r, cores.get(id)!, q), ...lbRateLimit(r, q), health: lbHealthPolicy(r, q) }); break;
        case "Database": {
          const plan = (op: string) => ({ statements: [{ kind: op === "write" ? "write" as const : "snapshot-read" as const, keys: (r.dataKeyspace?.count ?? 1) > 1 ? ["$key"] : ["key"], cpu: q(`${id}.${op}.cpu`, op === "write" ? 2000 : 1000, "cpu-us"), parallelism: q(`${id}.${op}.parallelism`, 1, "cores"), blockingWait: q(`${id}.${op}.wait`, 0, "us"), logBytes: q(`${id}.${op}.log`, 0, "bytes") }], statementTimeout: q(`${id}.${op}.statementTimeout`, 1000000, "us"), lockTimeout: q(`${id}.${op}.lockTimeout`, 1000000, "us"), transactionTimeout: q(`${id}.${op}.transactionTimeout`, 2000000, "us"), commitWait: q(`${id}.${op}.commitWait`, 0, "us"), durability: "logical-only" as const });
          add(r, "main", { ...(r.databaseReplication === undefined ? {} : { replication: { ...r.databaseReplication } }), kind: "relational", semantics: "postgresql-keyed/2", execution: execution(r, "main"), maxSessions: q(`${id}.sessions`, r.skuId ? findSku(r.skuId)!.maxConnections! : 100, "count", r.skuId ? "The selected catalog maxConnections is an approximation (owner verify), not a provider guarantee. Each open connection holds one session; a full database refuses new connections." : "Generic PostgreSQL default max_connections is 100. Each open connection holds one session; a full database refuses new connections."), activeTransactions: r.dbConcurrency?.activeQueries !== undefined ? q(`${id}.active`, r.dbConcurrency.activeQueries, "count", "Saved active query execution slots; an educational admission gate, not a PostgreSQL provider setting.", true) : q(`${id}.active`, 16 * cores.get(id)!, "count"), pendingQueries: r.dbConcurrency?.queuedQueries !== undefined ? q(`${id}.pending`, r.dbConcurrency.queuedQueries, "count", "Saved capacity for database queries waiting for an execution slot; a full queue refuses work.", true) : q(`${id}.pending`, 256, "count"), ...databaseKeyspace(r, q(`${id}.row`, MODELED_ROW_BYTES, "bytes")), plans: Object.fromEntries(operations.map((op) => [op, plan(op)])) }); break;
        }
        case "Cache":
          if (target && target.type !== "Database") { error(`resources.${id}`, "Connect the cache to one database for cache-aside reads and write invalidation."); break; }
          add(r, "main", { kind: "cache", semantics: "keyed-cache/1", execution: execution(r, "main"), capacity: cacheCapacity(r), entryOverhead: q(`${id}.overhead`, MODELED_CACHE_ENTRY_OVERHEAD_BYTES, "bytes"), policy: "lru", ttl: changedCacheTtl(r) ? q(`${id}.ttl`, r.cachePolicy!.ttlSeconds! * 1000000, "us", "Saved cache TTL in seconds converted to microseconds; expiry is measured from each successful fill.", true) : q(`${id}.ttl`, 60000000, "us"), initial: [], commandCpu: q(`${id}.cpu`, 100, "cpu-us") });
          if (!target) break;
          add(r, "aside", { kind: "cache-aside", execution: execution(r, "aside"), cache: "$self", database: `$${target.id}`, ...asideKeyspace(target), coalesce: singleFlight(id, r), onCacheFailure: "database", invalidateWrites: true, operations: { read: "read", write: "write", health: "read" } }); internal(r, "aside", "main"); break;
        case "Object Storage": objects(r, "main"); break;
        case "CDN":
          if (target?.type !== "Object Storage") { error(`resources.${id}`, "Connect the CDN to one object store; dynamic app origins need an authored HTTP plan."); break; }
          add(r, "main", { kind: "cdn", ...command(r, "main", ["get"]), origin: `$${target.id}`, namespace: "web", keys: { read: "asset", write: "asset", health: "asset" }, capacity: q(`${id}.capacity`, memory.get(id)! * 1073741824, "bytes"), ttl: cdnTtl(r, q), ...cdnCoalescing(r, q) }); break;
        case "Container Registry":
          if (target?.type !== "Object Storage") { error(`resources.${id}`, "Connect the registry to an object store for its blobs and manifests."); break; }
          add(r, "main", { kind: "registry", ...command(r, "main", ["upload", "manifest", "tag", "resolve", "blob"]), store: `$${target.id}`, namespace: "registry" }); break;
        case "DNS":
          if (target?.id !== entry.id) { error(`resources.${id}`, "Point DNS at the design's single load balancer, CDN or app entry point."); break; }
          add(r, "main", { kind: "dns-authority", ...command(r, "main", ["resolve"]), records: [], negativeTtl: q(`${id}.negativeTtl`, 5000000, "us") });
          add(r, "resolver", { kind: "dns-resolver", ...command(r, "resolver", ["resolve"]), authority: "$self", cacheEntries: q(`${id}.entries`, 128, "count") }); internal(r, "resolver", "main", "dns-query"); break;
        case "Firewall": n.firewall = { profile: "ordered-stateful/1", default: "allow", rules: [], maxFlows: firewallCapacity(r, cores.get(id)!, q, ledger) }; break;
        case "Message Queue": add(r, "main", { kind: "delivery-queue", profile: "visibility-work-queue/1", ...command(r, "main", ["publish", "receive", "ack", "nack"]), capacityMessages: queueMessageCapacity(r, cores.get(id)!, q), capacityBytes: q(`${id}.bytes`, memory.get(id)! * 1073741824, "bytes"), lease: q(r.asyncQueue?.enabled ? `${id}.asyncQueue.visibilityTimeoutSeconds` : `${id}.lease`, r.asyncQueue?.enabled ? r.asyncQueue.visibilityTimeoutSeconds! * 1000000 : 30000000, "us", undefined, !!r.asyncQueue?.enabled), retention: q(r.asyncQueue?.enabled ? `${id}.asyncQueue.retentionSeconds` : `${id}.retention`, r.asyncQueue?.enabled ? r.asyncQueue.retentionSeconds! * 1000000 : 300000000, "us", undefined, !!r.asyncQueue?.enabled), maxAttempts: q(r.asyncQueue?.enabled ? `${id}.asyncQueue.maxReceives` : `${id}.attempts`, r.asyncQueue?.enabled ? r.asyncQueue.maxReceives! : 3, "count", undefined, !!r.asyncQueue?.enabled), dlqMessages: r.asyncQueue?.enabled && r.asyncQueue.deadLetterCapacity !== undefined ? q(`${id}.asyncQueue.deadLetterCapacity`, r.asyncQueue.deadLetterCapacity, "count", "Saved bounded dead-letter list size; overflow discards are counted.", true) : q(`${id}.dlq`, 1000, "count"), dlqBytes: q(`${id}.dlqBytes`, 1048576, "bytes"), deduplicatePublishes: true, consumers: r.asyncQueue?.enabled ? outgoing(id).filter((r) => r.asyncWorker?.enabled).map((w) => ({ id: `$${w.id}`, credit: q(`${w.id}.asyncWorker.credit`, w.asyncWorker!.prefetch!, "count", "Saved worker prefetch credit mirrored by the broker.", true) })) : [{ id: "worker", credit: q(`${id}.credit`, 1, "count") }] }); break;
        case "Monitoring Agent":
          add(r, "main", { kind: "monitor", ...command(r, "main", ["collect", "export"]), targets: [], backend: "$self/backend", operation: "read", ...monitoringCadence(r, q), freshFor: q(`${id}.fresh`, 30000000, "us"), sampleBytes: q(`${id}.sample`, 128, "bytes"), bufferBytes: q(`${id}.bufferBytes`, 1048576, "bytes"), ...monitoringBuffer(r, q) });
          add(r, "backend", { kind: "telemetry-backend", ...command(r, "backend", ["export"]), samples: q(`${id}.samples`, 10000, "count") }); internal(r, "main", "backend", "telemetry-export"); break;
      }
    }
    for (const r of resources.filter((r) => r.asyncWorker?.enabled)) {
      const fact = ledger.find((e) => e.id === `${r.id}.asyncWorker.credit`)!;
      fact.provenance[0]!.source = `saved-design:${r.id}.asyncWorker.prefetch`;
    }
    if (refused.length) return { refused };
    note("database.deadlines", { statementUs: 1000000, transactionUs: 2000000 }, "authored assumption", "Canvas statement and transaction deadlines are authored 1 s / 2 s limits, unlike PostgreSQL/RDS defaults of 0 (disabled). They bound queued work and shorten the unhealthy phase after cache recovery; open idle sessions can persist for the pool idle timeout.");
    const enqueue = (id: string, source: string, target: string, at: number, request: unknown, bytes = 0) => commands.push({ id, source, target, at: q(`${id}.at`, at, "us"), operation: "read", request, bodyBytes: q(`${id}.body`, bytes, "bytes"), provenance: "Assumed bootstrap command, not application traffic." });
    const seedRegistry = (id: string, source: string, target: string) => {
      const digest = `sha256:${"a".repeat(64)}`, manifest = `sha256:${"b".repeat(64)}`;
      enqueue(`${id}.blob`, source, target, 0, { kind: "upload", digest, bytes: 1024 }, 1024);
      enqueue(`${id}.manifest`, source, target, 100000, { kind: "manifest", digest: manifest, bytes: 128, layers: [{ digest, bytes: 1024 }] }, 128);
      enqueue(`${id}.tag`, source, target, 200000, { kind: "tag", tag: "release", digest: manifest });
    };
    for (const r of resources.filter((r) => r.circuitBreaker?.enabled)) {
      const p = r.circuitBreaker!, id = `${r.id}.circuitBreaker`, node = nodes[r.id]!;
      const fixed = (name: string, sentence: string) => {
        const value = q(`${id}.${name}`, 1, "count", sentence, true), fact = ledger.at(-1)!;
        Object.assign(fact, { classification: "implementation-policy", provenance: [{ source: "caller-circuit-breaker/1", supports: "implementation", detail: sentence }], assumptions: [sentence] });
        return value;
      };
      node.profileVersion += "/caller-circuit-breaker/1";
      node.circuitBreaker = { profile: "caller-circuit-breaker/1",
        failureThreshold: q(`${id}.failureThreshold`, p.failureThreshold!, "count", "Saved consecutive failure threshold.", true),
        cooldown: q(`${id}.cooldownMs`, p.cooldownMs! * 1000, "us", "Saved cooldown in milliseconds converted to microseconds.", true),
        maxProbes: fixed("maxProbes", "Version one permits exactly one simultaneous half-open probe."),
        successfulProbesToClose: fixed("successfulProbesToClose", "Version one closes after one successful reserved probe."),
        authored: { enabled: { value: true, sources: [`saved-design:${id}.enabled`] } },
      };
    }
    for (const r of resources.filter((r) => r.retry?.enabled)) {
      const p = r.retry!, id = `${r.id}.retry`, node = nodes[r.id]!;
      const config = node.resources.find((r) => r.config.kind === "load-balancer")!.config;
      if (config.kind !== "load-balancer") throw Error("Retry owner must be a load balancer");
      const groups = { connectionFailure: ["connect-timeout", "reset", "drained"], timeout: ["acquire-timeout", "response-timeout"], overload: ["pool-overflow", "link-overflow"], backendFailure: ["backend-rejected"] } as const;
      node.profileVersion += "/canvas-retries/1";
      config.retry = {
        profile: "canvas-retries/1", enforceCallerDeadline: true, reserveBackoffBudget: true, preferDifferentBackend: true,
        maxAttempts: q(`${id}.maxAttempts`, p.maxAttempts!, "count", "Saved total attempt limit, including the first attempt.", true),
        backoff: q(`${id}.backoffMs`, p.backoffMs! * 1000, "us", "Saved backoff in milliseconds converted to microseconds.", true),
        jitter: q(`${id}.jitterRatio`, p.jitterRatio!, "ratio", "Saved deterministic jitter ratio.", true),
        maxConcurrentRetries: q(`${id}.maxConcurrentRetries`, p.maxConcurrentRetries!, "count", "Saved limit for waiting and executing retries.", true),
        retryOn: p.retryOn!.flatMap((g) => [...groups[g]]), allowAmbiguousNonIdempotent: false,
        authored: { enabled: { value: true, sources: [`saved-design:${id}.enabled`] }, retryOn: { value: [...p.retryOn!], sources: [`saved-design:${id}.retryOn`] } },
      };
    }
    for (const r of resources.filter((r) => r.autoscaling?.enabled)) {
      const p = r.autoscaling!, id = r.id, lb = incoming(id).find((s) => s.type === "Load Balancer")!;
      if (p.minReplicas === undefined || p.maxReplicas === undefined || p.targetCpu === undefined) { error(`resources.${id}.autoscaling`, "Set the minimum replicas, maximum replicas and CPU target before enabling autoscaling."); continue; }
      const registry = outgoing(id).find((t) => t.type === "Container Registry");
      // Missing image infrastructure is explicit, owned startup overhead, not a drawn node.
      if (!registry) {
        objects(r, "image-store");
        add(r, "registry", { kind: "registry", ...command(r, "registry", ["upload", "manifest", "tag", "resolve", "blob"]), store: "$self/image-store", namespace: "registry" });
        internal(r, "registry", "image-store", "origin"); internal(r, "image", "registry", "artifact");
      }
      add(r, "image", { kind: "artifact-client", ...command(r, "image", ["start"]), registry: registry ? `$${registry.id}` : "$self/registry", cacheBytes: q(`${id}.image.cache`, 1048576, "bytes"), attempts: q(`${id}.image.attempts`, 3, "count"), backoff: q(`${id}.image.backoff`, 1000000, "us"), replicas: [] });
      for (let slot = 0; slot < (registry ? 1 : p.maxReplicas) && slot < 128; slot++) seedRegistry(`${id}.seed.${slot}`, `$${id}#${slot}/image`, registry ? `$${registry.id}` : `$${id}#${slot}/registry`);
      nodes[id]!.controller = { schema: "generic-reconcile/1", version: "1", provenance: [SOURCE], loadBalancer: `$${lb.id}`, initialReady: true, initial: q(`${id}.controller.initial`, p.minReplicas, "count"), min: q(`${id}.controller.min`, p.minReplicas, "count", "The pool minimum comes from the saved policy.", true), max: q(`${id}.controller.max`, p.maxReplicas, "count", "The pool maximum comes from the saved policy.", true), slots: q(`${id}.controller.slots`, p.maxReplicas, "count"), target: q(`${id}.controller.target`, p.targetCpu / 100, "ratio", "The CPU target comes from the saved percentage.", true), interval: q(`${id}.controller.interval`, 10000000, "us"), tolerance: q(`${id}.controller.tolerance`, 0.1, "ratio"), cooldown: q(`${id}.controller.cooldown`, 10000000, "us"), downStabilization: q(`${id}.controller.stabilization`, 30000000, "us"), provision: q(`${id}.controller.provision`, 1000000, "us"), startup: q(`${id}.controller.startup`, 1000000, "us"), drain: q(`${id}.controller.drain`, 5000000, "us"), attempts: q(`${id}.controller.attempts`, 3, "count"), retry: q(`${id}.controller.retry`, 1000000, "us"), signal: { kind: "direct-core-time" }, artifact: { node: id, role: "image", reference: "release" }, provisionFailures: [], manual: [] };
      note(`${id}.controller.bootstrap`, registry ? "drawn registry" : "owned registry and object store", "policy", "Scaling uses one assumed small release image in the drawn registry or owned startup services; initially ready replicas already have their image.");
    }
    for (const e of connections) {
      const s = byId.get(e.sourceId)!, t = byId.get(e.targetId)!;
      let purpose: EdgeContract["purpose"] = "dependency", sourceRole = "main", targetRole = "main";
      if (s.asyncQueue?.enabled && t.asyncWorker?.enabled) { edges[e.id] = edge(s, `edge.${e.id}`, "main", "main", "queue-poll"); continue; }
      if (s.type === "Virtual Machine" && (s.asyncWorker?.enabled || producerQueue(s.id)) && ["Event Bus", "Message Queue", "Object Storage"].includes(t.type)) { edges[e.id] = edge(t, `edge.${e.id}`, s.asyncWorker?.enabled ? "main" : "publisher", "main", "consumer", e.port, true); continue; }
      if (s.type === "Firewall") purpose = "policy-attachment";
      else if (s.type === "API Gateway" && ["Virtual Machine", "Load Balancer"].includes(t.type)) purpose = "dependency";
      else if (s.type === "Event Bus" && t.type === "Message Queue") purpose = "consumer";
      else if (s.type === "Load Balancer" && t.type === "Virtual Machine") purpose = "routing";
      else if (s.type === "Virtual Machine" && s.applicationFlow && ["Virtual Machine", "Load Balancer", ...(s.applicationFlow.schema !== "application-flow/1" ? ["Database", "Cache"] : [])].includes(t.type)) { purpose = "dependency"; targetRole = t.type === "Cache" ? "aside" : "main"; }
      else if (s.type === "Monitoring Agent" && t.type !== "Firewall") purpose = "monitor-target";
      else if (["CDN", "Container Registry"].includes(s.type) && t.type === "Object Storage") purpose = "origin";
      else if (s.type === "Cache" && t.type === "Database") sourceRole = "aside";
      else if (s.type === "DNS" && t.id === entry.id) purpose = "dependency";
      else if (s.type === "Virtual Machine" && ["Database", "Cache"].includes(t.type)) {
        if (nodes[s.id]!.resources.some((c) => c.role === "aside")) sourceRole = "aside";
        else targetRole = t.type === "Cache" ? "aside" : "main";
      }
      else if (s.type === "Virtual Machine" && s.autoscaling?.enabled && t.type === "Container Registry") { purpose = "artifact"; sourceRole = "image"; }
      else if (s.type === "Virtual Machine" && ["Object Storage", "Message Queue", "Container Registry"].includes(t.type) && !s.autoscaling?.enabled) {
        purpose = t.type === "Container Registry" ? "artifact" : "consumer";
        if (t.type === "Container Registry") seedRegistry(e.id, `$${s.id}`, `$${t.id}`);
        else enqueue(`${e.id}.bootstrap`, `$${s.id}`, `$${t.id}`, 1000000, t.type === "Object Storage" ? { kind: "get", namespace: "web", key: "asset" } : { kind: "publish", logicalId: "assumed-job", delayUs: 0, body: { key: "key", namespace: "web", objectKey: "asset", bytes: 1024 } });
      } else { error(`connections.${e.id}`, `Model 2 has no default operation for ${s.type} calling ${t.type}; change this connection or supply an application contract.`); continue; }
      edges[e.id] = edge(t, `edge.${e.id}`, sourceRole, targetRole, purpose, e.port, true);
    }
    if (refused.length) return { refused };
    // A saved listener setting applies to every role another resource or the caller dials; roles only reached by internal hops keep inferred ports.
    const dialled = new Set(connections.map(e => `${e.targetId}/${edges[e.id]!.targetRole}`));
    for (const r of resources) if (r.type === "DNS") dialled.add(`${r.id}/resolver`);
    let address = 1;
    for (const r of resources) {
      const n = nodes[r.id]!, count = r.autoscaling?.enabled ? r.autoscaling.maxReplicas! : 1;
      for (const { role } of n.resources) {
        n.identities.push({ role, zone: "internal", address: Array.from({ length: Math.min(count, 128) }, () => { const a = address++; return `10.0.${Math.floor(a / 254)}.${a % 254 + 1}`; }).join(",") });
        const ports = new Set((role === n.primary || dialled.has(`${r.id}/${role}`) ? r.listenerSettings?.ports : undefined) ?? [RESOURCE_PORTS[r.type], ...connections.filter((e) => e.targetId === r.id && edges[e.id]!.targetRole === role).map((e) => e.port)]);
        for (const port of [...ports].sort((a, b) => a - b)) n.listeners.push({ role, protocol: "tcp", port: q(`${r.id}.${role}.listener.${port}`, port, "count", r.listenerSettings !== undefined ? "Saved explicit TCP listener port." : undefined, r.listenerSettings !== undefined), tls: "plaintext" });
      }
    }
    for (const r of resources) {
      const n = nodes[r.id]!;
      if (r.listenerSettings !== undefined) n.listenerIntent = { version: 1, ports: [...r.listenerSettings.ports] };
      if (r.firewallSettings) {
        const p = r.firewallSettings;
        n.firewall!.default = p.default;
        n.firewall!.rules = [...p.rules].sort((a,b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(rule => ({
          id: rule.id, priority: q(`${r.id}.rule.${rule.id}.priority`, rule.priority, "count", "Saved rule priority.", true),
          direction: rule.direction, protocol: "tcp", action: rule.action,
          source: rule.source === "any" ? { kind: "any" } : { kind: "identity", value: `$${rule.source}` },
          destination: rule.destination === "any" ? { kind: "any" } : { kind: "identity", value: `$${rule.destination}` },
          fromPort: q(`${r.id}.rule.${rule.id}.fromPort`, rule.fromPort, "count", "Saved first TCP port.", true),
          toPort: q(`${r.id}.rule.${rule.id}.toPort`, rule.toPort, "count", "Saved last TCP port.", true),
        }));
      }
      if (r.listenerSettings !== undefined || r.firewallSettings !== undefined) {
        n.profileVersion += "/canvas-security/1";
        n.provenance.push(`saved-design:${r.id}.security`);
        n.authoredSecurity = { ...(r.listenerSettings !== undefined ? { listenerSettings: { value: r.listenerSettings, sources: [`saved-design:${r.id}.listenerSettings`] } } : {}), ...(r.firewallSettings !== undefined ? { firewallSettings: { value: r.firewallSettings, sources: [`saved-design:${r.id}.firewallSettings`] } } : {}) };
      }
    }
    const payloads = gatewayPayloads ?? assumedPayloads(q);
    const payload = payloads[design.workload.payloadSize];
    const assumedTransport: ProductContract["transports"][string] = { version: "canvas-assumptions/2", ownership: "per-path", provenance: [SOURCE], links: ["request", "response"].map((id) => ({ id, from: id === "request" ? "$source" : "$target", to: id === "request" ? "$target" : "$source", policy: "fifo-message/1", bandwidth: q(`link.${id}.bandwidth`, 125000000, "bytes/s"), propagation: q(`link.${id}.propagation`, 100, "us"), bufferBytes: q(`link.${id}.buffer`, 16777216, "bytes") })), pool: { mode: "serial", reuse: true, maxConnections: q("pool.connections", 32, "count"), streams: q("pool.streams", 1, "count"), pending: q("pool.pending", 256, "count"), establish: q("pool.establish", 100, "us"), acquireTimeout: q("pool.acquireTimeout", 1000000, "us"), connectTimeout: q("pool.connectTimeout", 1000000, "us"), responseTimeout: q("pool.responseTimeout", 4000000, "us"), remoteCancellation: "request-cancellation" }, bytes: Object.fromEntries(operations.map((id) => [id, { request: payload, response: payload }])) };
    const contract: ProductContract = {
      ...(hasSecurity ? { securityProfile: "canvas-security/1" as const } : {}),
      ...(hasFlow ? { applicationFlowProfile: flowProfile } : {}),
      ...(profiles.includes("traffic-evidence/2") ? { trafficEvidenceProfile: "traffic-evidence/2" as const } : {}),
      ...(failureCause ? { failureCauseProfile: "failure-cause/1" as const } : {}),
      schema: "infraforge-product-model2/1", version: (failureCause ? "canvas-assumptions/2/failure-cause/1" : "canvas-assumptions/2") + (hasKeyspace ? `/${KEYSPACE_PROFILE}` : "") + (hasHotKey ? `/${HOT_KEY_PROFILE}` : "") + (hasCachePolicy ? `/${CACHE_POLICY_PROFILE}` : "") + (hasCacheCapacity ? `/${CACHE_CAPACITY_PROFILE}` : "") + (hasVmExecution ? `/${VM_EXECUTION_PROFILE}` : "") + (hasVmMemory ? `/${VM_MEMORY_PROFILE}` : "") + (hasVmCpuQuota ? `/${VM_CPU_QUOTA_PROFILE}` : "") + (hasDatabaseReplication ? `/${DATABASE_REPLICATION_PROFILE}` : "") + (hasDbConcurrency ? `/${DB_CONCURRENCY_PROFILE}` : "") + (hasLbRateLimit ? `/${LB_RATE_LIMIT_PROFILE}` : "") + (hasLbAdmission ? `/${LB_ADMISSION_PROFILE}` : "") + (hasLbSelection ? `/${LB_SELECTION_PROFILE}` : "") + (hasLbHealth ? `/${LB_HEALTH_PROFILE}` : "") + (hasQueueIdempotency ? `/${QUEUE_IDEMPOTENCY_PROFILE}` : "") + (hasQueueCapacity ? `/${QUEUE_CAPACITY_PROFILE}` : "") + (hasCdnTtl ? `/${CDN_TTL_PROFILE}` : "") + (hasCdnCoalescing ? `/${CDN_COALESCING_PROFILE}` : "") + (hasMonitoringCadence ? `/${MONITOR_CADENCE_PROFILE}` : "") + (hasMonitoringBuffer ? `/${MONITOR_BUFFER_PROFILE}` : "") + (hasObjectCapacity ? `/${OBJECT_CAPACITY_PROFILE}` : "") + (hasFirewallCapacity ? `/${FIREWALL_CAPACITY_PROFILE}` : "") + (arrivalVersion(design.workload) === "product-arrivals/2" ? "/product-arrivals/2" : "") + (gatewayIntent(resources) ? "/" + API_GATEWAY_PROFILE : "") + (eventBusIntent(resources) ? "/" + EVENT_BUS_PROFILE : "") + (hasFlow ? `/${flowProfile}` : ""), designVersion: "saved-domain/1", catalogVersion: CATALOG_SNAPSHOT_DATE, workloadVersion: arrivalVersion(design.workload), ledger, nodes, edges, capabilities,
      application: { schema: "infraforge-application/1", id: "canvas-default", version: "1", provenance: [SOURCE], validityDomain: SCOPE, controlOperation: "health", readOperation: "read", writeOperation: "write", payloads, operations: operations.map((id) => ({ id, callerTimeout: q(`application.${id}.timeout`, 5000000, "us"), onCallerStop: "request-cancellation", idempotency: id === "write" ? "non-idempotent" : "read-only" })), demands: operations.map((op) => ({ schema: "infraforge-compute-demand/1", id: `canvas.${op}`, version: "1", application: "canvas-default", operation: op, stage: "compute", method: "synthetic", cpu: q(`application.${op}.cpu`, op === "health" ? 100 : op === "write" ? 6000 : 3000, "cpu-us"), blockingWait: q(`application.${op}.wait`, 0, "us"), maxCpuParallelism: q(`application.${op}.parallelism`, 1, "cores"), residentCoverage: "partial", obtainedBy: "Explicit educational defaults", evidence: [SOURCE], date: "2026-10-27", validity: { exact: { environment: "canvas-assumptions" }, ranges: {} }, uncertainty: [SCOPE], freeMode: "forbidden" })) },
      transports: { assumed: assumedTransport, caller: { ...assumedTransport, pool: { ...assumedTransport.pool, maxConnections: q("pool.caller.connections", 512, "count", "Authored open-loop load-generator allowance of 512 concurrent serial connections; this is separate from each app-to-database pool and is not a browser client default.") } }, cache: { ...assumedTransport, pool: { ...assumedTransport.pool, connectTimeout: q("pool.cache.connectTimeout", 10000, "us", "Authored 10 ms cache connect timeout: an unavailable optional cache falls back promptly rather than throttling database demand for a second."), responseTimeout: q("pool.cache.responseTimeout", 10000, "us", "Authored 10 ms cache response timeout for prompt cache-aside fallback, not a Redis/provider default; no retry is added.") } }, database: { ...assumedTransport, pool: { ...assumedTransport.pool, evidenceProfile: "postgresql-pools/2", maxConnections: q("pool.database.connections", 10, "count", "Authored assumption modelled on node-postgres-style pooling: lazy open, at most 10 connections per source replica and database path; the acquire timeout is an authored assumption."), idleTimeout: q("pool.database.idleTimeout", 10000000, "us", "Authored node-postgres-style idle close after 10 seconds.") } } },
      caller: { address: "198.51.100.1", entry: `$${entry.id}`, transport: "caller", request: ["request"], response: ["response"], security: security(entry, RESOURCE_PORTS[entry.type], "caller"), dependencies: [] },
      seed: "canvas-assumptions/2", horizon: q("run.horizon", 30000000, "us", "A saved canvas has no duration, so the default run lasts thirty seconds."), sampleInterval: q("run.sampleInterval", 1000000, "us"), arrival: { start: q("arrival.start", 0, "us"), ...(design.workload.trafficShape === "peak" ? { peak: { start: q("arrival.peak.start", 10000000, "us"), end: q("arrival.peak.end", 20000000, "us") } } : {}) },
      // New LB selection captures reserve a smaller base flow allowance so nested
      // balancers can fit the existing fan-out multiplier and global event ceiling.
      limits: { maxEvents: hasFlow ? hasLbSelection ? 500000 : 1000000 : 2000000, maxSamples: 1000, maxRequests: 100000, maxTraceRows: 100000, maxRawResults: 1000 }, instrumentation: [], commands, faults: [],
    };
    for (const r of resources.filter((r) => r.type === "DNS")) {
      const authority = nodes[r.id]!.resources[0]!.config;
      if (authority.kind === "dns-authority") authority.records.push({ name: "app.example", type: "A", addresses: [nodes[entry.id]!.identities.find((i) => i.role === "main")!.address], generation: 1, ttl: q(`${r.id}.ttl`, 60000000, "us") });
      contract.caller.dependencies.push({ id: r.id, target: `$${r.id}/resolver`, ...edge(r, `caller.dns.${r.id}`, "external", "resolver", "dns-query") });
      contract.caller.security.dns = { name: "app.example", resolver: `$${r.id}/resolver`, routes: [{ address: nodes[entry.id]!.identities[0]!.address, path: "external-entry" }] };
    }
    for (const target of [...new Set(resources.filter((r) => r.type === "Monitoring Agent").flatMap((r) => outgoing(r.id).map((t) => t.id)))].sort()) contract.instrumentation.push({ target: `$${target}`, bytes: q(`instrumentation.${target}`, 128, "bytes") });
    for (const r of resources.filter(r => r.applicationFlow)) {
      nodes[r.id]!.profileVersion += `/${r.applicationFlow!.schema}`;
      nodes[r.id]!.provenance.push(`saved-design:${r.id}.applicationFlow`);
      note(`${r.id}.applicationFlow.worker`, "thread-per-request: worker held while waiting", "policy", "Authored assumption: thread-per-request: worker held while waiting; waiting consumes no CPU.");
    }
    note("security.scope", "logical TCP admission only", "policy", "Public exposure, encryption and open ports stay saved metadata; assumed listeners and allow policies do not certify the design's security.");
    note("application.scope", hasHotKey ? "hot-key multi-key educational application" : hasKeyspace ? "uniform multi-key educational application" : "one-key educational application", "policy", asyncQueues.length ? flow3 ? "An authored write publish step uploads one object, publishes once and waits for broker confirmation of logical ownership; physical durability Unknown. Worker completion is separate. No retry or rollback is implied." : "Each served producer request uploads one object and publishes one message; the worker reads it, spends authored CPU, writes a result and acknowledges. Other service edges retain their bootstrap behavior." : hasHotKey ? "Requests use each database's saved access pattern: hot-key mode sends about 80% to its stable first key and distributes the rest across the remaining keys; queue, object and registry edges retain explicit bootstrap commands." : hasKeyspace ? "Requests select uniformly from each database's saved finite data keyspace using deterministic keyed selection; queue, object and registry edges retain explicit bootstrap commands." : "Requests use one assumed key; queue, object and registry edges receive explicit bootstrap commands rather than invented application fan-out.");
    if (arrivalVersion(design.workload) === "product-arrivals/2") note("workload.arrivals", "seeded Poisson open-loop", "policy", "Exponential hazard is carried across piecewise-constant peak and live load boundaries; read/write choices use a separate keyed draw; the captured run seed owns both streams.");
    else note("workload.arrivals", "deterministic open-loop", "policy", "Requests begin immediately at evenly spaced intervals with a fractional read/write mixture; peak traffic occupies seconds ten through twenty.");
    for (const r of saved.resources.filter((r) => r.type === "Load Balancer" && r.autoscaling?.enabled)) note(`${r.id}.poolMapping`, resources.filter((x) => x.autoscaling?.enabled).map((x) => x.id), "policy", "The first app by ID owns the adjustable replicas while its drawn siblings stay fixed, preserving the load balancer's total replica bounds.");
    // Non-numeric policy choices are also reviewable; quantity leaves are already listed above.
    const inspect = (value: unknown, path: string): void => {
      if (hasSecurity && (path.includes(".authoredSecurity") || path.includes(".listenerIntent") || resources.some(r => r.firewallSettings && (path.startsWith(`contract.nodes.${r.id}.firewall.rules`) || path === `contract.nodes.${r.id}.firewall.default`)))) return;
      if (path.includes(".circuitBreaker")) return; // Authored settings and fixed v1 policy quantities have explicit provenance.
      if (path.includes(".config.retry")) return; // Authored quantities and enum/list origins are retained by the retry profile.
      if (/^contract\.nodes\.[^.]+\.type$/.test(path)) return; // The user chose the resource type.
      if (value && typeof value === "object" && "kind" in value && "unit" in value && "provenance" in value) return;
      if (value && typeof value === "object" && Object.keys(value).length) { for (const [key, child] of Object.entries(value)) if (!["ledger", "capabilities", "provenance", "evidence"].includes(key)) inspect(child, `${path}.${key}`); }
      else note(`default.${path}`, value, "setting", `The assumed ${path.replaceAll(".", " ")} is ${JSON.stringify(value)}.`);
    };
    bindVmMemoryProfiles(resources, contract, q);
    compileCpuDynamics(design.workload, contract);
    compileClientRetry(design.workload, contract);
    compileObjective(design.workload, contract);
    inspect(contract, "contract");
    const compiled = compileProduct(saved, contract);
    if (!compiled.ok) return { refused: compiled.diagnostics.map((d) => ({ ...d, message: `This design cannot run with the default profile: ${d.message}` })) };
    return { contract: canonical(contract), assumptions: assumptions.sort((a, b) => a.id < b.id ? -1 : 1) };
  } catch (cause) {
    error("design", `This saved design needs correction before it can run: ${cause instanceof Error ? cause.message : "invalid saved data"}.`);
    return { refused };
  }
}
