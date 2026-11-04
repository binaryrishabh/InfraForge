import { apiGatewayError } from "@infraforge/domain/resource";
import { eventBusError } from "@infraforge/domain/resource";
import { lbRateLimitError, LB_RATE_BURST_MAX, LB_RATE_MIN_RPS, LB_RATE_MAX_RPS } from "@infraforge/domain/resource";
import * as z from "zod";
import { firewallStateError, firewallCapacityError, FIREWALL_IDLE_SECONDS_MAX, FIREWALL_FLOW_CAPACITY_MAX, objectStoragePolicyError, OBJECT_STORAGE_CAPACITY_MAX_MIB, dnsCachePolicyError, DNS_CACHE_MAX_TTL_SECONDS, monitoringPolicyError, MONITORING_BUFFER_MAX_SAMPLES, MONITORING_EXPORT_MAX_ATTEMPTS, MONITORING_CADENCE_MAX_SECONDS, cdnCachePolicyError, CDN_MAX_WAITERS, CDN_TTL_MAX_SECONDS, vmMemoryError, VM_MEMORY_MAX_MIB, vmCpuQuotaError, VM_CPU_LIMIT_MAX, VM_WORKERS_MAX, VM_QUEUED_REQUESTS_MAX, vmExecutionError, LB_HEALTH_SECONDS_MAX, LB_HEALTH_THRESHOLD_MAX, lbSelectionError, lbHealthError, LB_ACTIVE_MAX, LB_QUEUED_MAX, LB_QUEUE_WAIT_MAX_MS, DB_ACTIVE_QUERIES_MAX, DB_QUEUED_QUERIES_MAX, lbAdmissionError, databaseReadRoutingError, databaseReplicationError, dbConcurrencyError, CACHE_TTL_MAX_SECONDS, CACHE_CAPACITY_MAX_ENTRIES, cachePolicyError, DATA_KEYSPACE_MAX, dataKeyspaceError, securitySettingsError, applicationFlowError, asyncSettingsError, circuitBreakerSettingsError, RESOURCE_TYPES, RETRY_GROUPS, retrySettingsError } from "@infraforge/domain/resource";

const ResourceIdSchema = z.string().min(1).refine(
  (id) => !Object.hasOwn(Object.prototype, id),
  "Resource IDs cannot use reserved object property names",
);

const FlowCallSchema = z.object({ id: z.string(), kind: z.literal("call"), edge: z.string(), operation: z.enum(["read", "write"]).optional() }).strict();
const FlowStepsSchema = z.object({ steps: z.array(z.union([
  z.object({ id: z.string(), kind: z.literal("compute") }).strict(),
  FlowCallSchema,
  z.object({ id: z.string(), kind: z.literal("publish"), edge: z.string() }).strict(),
  z.object({ id: z.string(), kind: z.literal("data"), edge: z.string(), operation: z.enum(["read", "write"]) }).strict(),
  z.object({ id: z.string(), kind: z.literal("parallel"), branches: z.array(FlowCallSchema), wait: z.union([z.literal("all"), z.number()]) }).strict(),
])) }).strict();
const ApplicationFlowSchema = z.object({ schema: z.enum(["application-flow/1", "application-flow/2", "application-flow/3"]), operations: z.object({
  read: FlowStepsSchema.optional(), write: FlowStepsSchema.optional(),
}).strict() }).strict();
const CachePolicyV1Schema = z.object({ version: z.literal(1), ttlSeconds: z.number().int().min(1).max(CACHE_TTL_MAX_SECONDS).optional(), singleFlight: z.boolean().optional() }).strict();
const CachePolicySchema = z.discriminatedUnion("version", [CachePolicyV1Schema, CachePolicyV1Schema.extend({
  version: z.literal(2), capacityEntries: z.number().int().min(1).max(CACHE_CAPACITY_MAX_ENTRIES),
}).strict()]);

const ResourceSchema = z.object({
  apiGateway: z.object({ version: z.literal(1), maxRequestBytes: z.number().int().min(0).max(1048576).optional(), maxInFlight: z.number().int().min(1).max(10000).optional(), upstreamTimeoutMs: z.number().int().min(1).max(60000).optional(), routes: z.array(z.object({ id: z.string().min(1).max(64), edge: z.string().min(1).max(64), path: z.string().min(1).max(256), method: z.enum(["GET", "POST", "ANY"]), burstRequests: z.number().int().min(1).max(10000).optional(), requestsPerSecond: z.number().int().min(1).max(10000).optional() }).strict()).min(1).max(16).optional() }).strict().optional(),
  eventBus: z.object({ version: z.literal(1), capacityMessages: z.number().int().min(1).max(10000).optional(), maxAttempts: z.number().int().min(1).max(10).optional(), retryDelayMs: z.number().int().min(1).max(60000).optional(), deliveryTimeoutMs: z.number().int().min(1).max(60000).optional(), deadLetterCapacity: z.number().int().min(0).max(10000).optional(), subscriptions: z.array(z.object({ id: z.string().min(1).max(64), edge: z.string().min(1).max(64), filter: z.object({ keyPrefix: z.string().min(1).max(128) }).strict().optional() }).strict()).min(1).max(16).optional() }).strict().optional(),
  id: ResourceIdSchema,
  type: z.enum(RESOURCE_TYPES),
  x: z.number(),
  y: z.number(),
  skuId: z.string().optional(),
  cachePolicy: CachePolicySchema.optional(),
  firewallState: z.object({ version: z.literal(1), idleTimeoutSeconds: z.number().int().min(1).max(FIREWALL_IDLE_SECONDS_MAX) }).strict().optional(),
  firewallCapacity: z.object({ version: z.literal(1), maxFlows: z.number().int().min(1).max(FIREWALL_FLOW_CAPACITY_MAX) }).strict().optional(),
  objectStoragePolicy: z.object({ version: z.literal(1), capacityMiB: z.number().int().min(1).max(OBJECT_STORAGE_CAPACITY_MAX_MIB) }).strict().optional(),
  monitoringPolicy: z.discriminatedUnion("version", [
    z.object({ version: z.literal(1), collectionIntervalSeconds: z.number().int().min(1).max(MONITORING_CADENCE_MAX_SECONDS).optional(), exportIntervalSeconds: z.number().int().min(1).max(MONITORING_CADENCE_MAX_SECONDS).optional() }).strict(),
    z.object({ version: z.literal(2), collectionIntervalSeconds: z.number().int().min(1).max(MONITORING_CADENCE_MAX_SECONDS).optional(), exportIntervalSeconds: z.number().int().min(1).max(MONITORING_CADENCE_MAX_SECONDS).optional(), bufferSamples: z.number().int().min(1).max(MONITORING_BUFFER_MAX_SAMPLES), batchSamples: z.number().int().min(1).max(MONITORING_BUFFER_MAX_SAMPLES), exportAttempts: z.number().int().min(1).max(MONITORING_EXPORT_MAX_ATTEMPTS) }).strict(),
  ]).optional(),
  dnsCachePolicy: z.object({ version: z.literal(1), maxTtlSeconds: z.number().int().min(1).max(DNS_CACHE_MAX_TTL_SECONDS) }).strict().optional(),
  cdnCachePolicy: z.union([
    z.object({ version: z.literal(1), ttlSeconds: z.number().int().min(1).max(CDN_TTL_MAX_SECONDS) }).strict(),
    z.object({ version: z.literal(2), ttlSeconds: z.number().int().min(1).max(CDN_TTL_MAX_SECONDS).optional(), coalesce: z.boolean(), maxWaiters: z.number().int().min(1).max(CDN_MAX_WAITERS).optional() }).strict(),
  ]).optional(),
  lbSelection: z.object({ version: z.literal(1), policy: z.enum(["round-robin", "least-outstanding"]) }).strict().optional(),
  lbHealth: z.object({ version: z.literal(1), intervalSeconds: z.number().int().min(1).max(LB_HEALTH_SECONDS_MAX).optional(), timeoutSeconds: z.number().int().min(1).max(LB_HEALTH_SECONDS_MAX).optional(), unhealthyAfter: z.number().int().min(1).max(LB_HEALTH_THRESHOLD_MAX).optional(), healthyAfter: z.number().int().min(1).max(LB_HEALTH_THRESHOLD_MAX).optional() }).strict().optional(),
  lbRateLimit: z.object({ version: z.literal(1), burstRequests: z.number().int().min(1).max(LB_RATE_BURST_MAX), sustainedRequestsPerSecond: z.number().finite().min(LB_RATE_MIN_RPS).max(LB_RATE_MAX_RPS) }).strict().optional(),
  lbAdmission: z.object({ version: z.literal(1), maxActive: z.number().int().min(1).max(LB_ACTIVE_MAX).optional(), maxQueued: z.number().int().min(0).max(LB_QUEUED_MAX).optional(), queueWaitMs: z.number().int().min(1).max(LB_QUEUE_WAIT_MAX_MS).optional() }).strict().optional(),
  vmMemory: z.object({ version: z.literal(1), baselineMiB: z.number().int().min(0).max(VM_MEMORY_MAX_MIB), requestMiB: z.number().int().min(0).max(VM_MEMORY_MAX_MIB), activeMiB: z.number().int().min(0).max(VM_MEMORY_MAX_MIB) }).strict().optional(),
  vmCpuQuota: z.object({ version: z.literal(1), limitPercent: z.number().int().min(1).max(VM_CPU_LIMIT_MAX) }).strict().optional(),
  vmExecution: z.object({ version: z.literal(1), workers: z.number().int().min(1).max(VM_WORKERS_MAX).optional(), queuedRequests: z.number().int().min(0).max(VM_QUEUED_REQUESTS_MAX).optional() }).strict().optional(),
  databaseReadRouting: z.object({ version: z.literal(1), policy: z.enum(["primary-only", "replica-preferred"]) }).strict().optional(),
  databaseReplication: z.object({ version: z.literal(1), enabled: z.literal(true), replicationDelayMs: z.number().int().min(1).max(60000), readPolicy: z.enum(["primary", "replica-preferred"]) }).strict().optional(),
  dbConcurrency: z.object({ version: z.literal(1), activeQueries: z.number().int().min(1).max(DB_ACTIVE_QUERIES_MAX).optional(), queuedQueries: z.number().int().min(0).max(DB_QUEUED_QUERIES_MAX).optional() }).strict().optional(),
  dataKeyspace: z.object({ version: z.literal(1), count: z.number().int().min(1).max(DATA_KEYSPACE_MAX), accessPattern: z.enum(["uniform", "hot-key"]).optional() }).strict().optional(),
  autoscaling: z.object({
    enabled: z.boolean().optional(),
    minReplicas: z.number().int().positive().optional(),
    maxReplicas: z.number().int().positive().optional(),
    targetCpu: z.number().min(0).max(100).optional(),
  }).optional(),
  listenerSettings: z.object({ version: z.literal(1), ports: z.array(z.number().int().min(1).max(65535)).max(32) }).strict().optional(),
  firewallSettings: z.object({ version: z.literal(1), default: z.enum(["allow", "deny"]), rules: z.array(z.object({
    id: z.string().min(1).max(64), priority: z.number().int().min(0).max(65535), direction: z.enum(["ingress", "egress"]),
    source: z.string(), destination: z.string(), fromPort: z.number().int().min(1).max(65535), toPort: z.number().int().min(1).max(65535), action: z.enum(["allow", "deny"]),
  }).strict()).max(32) }).strict().optional(),
  applicationFlow: ApplicationFlowSchema.optional(),
  asyncQueue: z.object({ enabled: z.boolean(), visibilityTimeoutSeconds: z.number().optional(), maxReceives: z.number().optional(), retentionSeconds: z.number().optional(), deadLetterCapacity: z.number().optional(), capacityMessages: z.number().int().min(1).max(100000).optional() }).strict().optional(),
  asyncWorker: z.object({ enabled: z.boolean(), concurrency: z.number().optional(), prefetch: z.number().optional(), cpuMsPerJob: z.number().optional(), badJobPercent: z.number().optional(), idempotentResults: z.boolean().optional() }).strict().optional(),
  circuitBreaker: z.object({ enabled: z.boolean(), failureThreshold: z.number().optional(), cooldownMs: z.number().optional() }).strict().optional(),
  retry: z.object({
    enabled: z.boolean(),
    maxAttempts: z.number().optional(),
    backoffMs: z.number().optional(),
    jitterRatio: z.number().optional(),
    maxConcurrentRetries: z.number().optional(),
    retryOn: z.array(z.enum(RETRY_GROUPS)).optional(),
  }).strict().optional(),
  public: z.boolean().optional(),
  encryption: z.boolean().optional(),
  openPorts: z.array(z.number().int().min(0).max(65535)).optional(),
  size: z.enum(["small", "medium", "large"]).optional(),
  region: z.string().optional(),
  name: z.string().optional(),
}).catchall(z.json()).superRefine((resource, ctx) => {
  const gatewayMessage = apiGatewayError(resource.type, resource.apiGateway);
  if (gatewayMessage) ctx.addIssue({ code: "custom", path: ["apiGateway"], message: gatewayMessage });
  const busMessage = eventBusError(resource.type, resource.eventBus);
  if (busMessage) ctx.addIssue({ code: "custom", path: ["eventBus"], message: busMessage });
  const stateMessage = firewallStateError(resource.type, resource.firewallState);
  if (stateMessage) ctx.addIssue({ code: "custom", path: ["firewallState"], message: stateMessage });
  const firewallMessage = firewallCapacityError(resource.type, resource.firewallCapacity);
  if (firewallMessage) ctx.addIssue({ code: "custom", path: ["firewallCapacity"], message: firewallMessage });
  const objectMessage = objectStoragePolicyError(resource.type, resource.objectStoragePolicy);
  if (objectMessage) ctx.addIssue({ code: "custom", path: ["objectStoragePolicy"], message: objectMessage });
  const monitoringMessage = monitoringPolicyError(resource.type, resource.monitoringPolicy);
  if (monitoringMessage) ctx.addIssue({ code: "custom", path: ["monitoringPolicy"], message: monitoringMessage });
  const dnsMessage = dnsCachePolicyError(resource.type, resource.dnsCachePolicy);
  if (dnsMessage) ctx.addIssue({ code: "custom", path: ["dnsCachePolicy"], message: dnsMessage });
  const cdnMessage = cdnCachePolicyError(resource.type, resource.cdnCachePolicy);
  if (cdnMessage) ctx.addIssue({ code: "custom", path: ["cdnCachePolicy"], message: cdnMessage });
  const selectionMessage = lbSelectionError(resource.type, resource.lbSelection);
  if (selectionMessage) ctx.addIssue({ code: "custom", path: ["lbSelection"], message: selectionMessage });
  const healthMessage = lbHealthError(resource.type, resource.lbHealth);
  if (healthMessage) ctx.addIssue({ code: "custom", path: ["lbHealth"], message: healthMessage });
  const rateLimitMessage = lbRateLimitError(resource.type, resource.lbRateLimit);
  if (rateLimitMessage) ctx.addIssue({ code: "custom", path: ["lbRateLimit"], message: rateLimitMessage });
  const lbMessage = lbAdmissionError(resource.type, resource.lbAdmission);
  if (lbMessage) ctx.addIssue({ code: "custom", path: ["lbAdmission"], message: lbMessage });
  const memoryMessage = vmMemoryError(resource.type, resource.vmMemory, resource.asyncWorker?.enabled);
  if (memoryMessage) ctx.addIssue({ code: "custom", path: ["vmMemory"], message: memoryMessage });
  const quotaMessage = vmCpuQuotaError(resource.type, resource.vmCpuQuota, resource.asyncWorker?.enabled);
  if (quotaMessage) ctx.addIssue({ code: "custom", path: ["vmCpuQuota"], message: quotaMessage });
  const executionMessage = vmExecutionError(resource.type, resource.vmExecution, resource.asyncWorker?.enabled);
  if (executionMessage) ctx.addIssue({ code: "custom", path: ["vmExecution"], message: executionMessage });
  const routingMessage = databaseReadRoutingError(resource.type, resource.databaseReadRouting, resource.databaseReplication);
  if (routingMessage) ctx.addIssue({ code: "custom", path: ["databaseReadRouting"], message: routingMessage });
  const replicationMessage = databaseReplicationError(resource.type, resource.databaseReplication);
  if (replicationMessage) ctx.addIssue({ code: "custom", path: ["databaseReplication"], message: replicationMessage });
  const dbMessage = dbConcurrencyError(resource.type, resource.dbConcurrency);
  if (dbMessage) ctx.addIssue({ code: "custom", path: ["dbConcurrency"], message: dbMessage });
  const cacheMessage = cachePolicyError(resource.type, resource.cachePolicy);
  if (cacheMessage) ctx.addIssue({ code: "custom", path: ["cachePolicy"], message: cacheMessage });
  const keyspaceMessage = dataKeyspaceError(resource.type, resource.dataKeyspace);
  if (keyspaceMessage) ctx.addIssue({ code: "custom", path: ["dataKeyspace"], message: keyspaceMessage });
  const securityMessage = securitySettingsError(resource.type, resource.listenerSettings, resource.firewallSettings);
  if (securityMessage) ctx.addIssue({ code: "custom", path: ["security"], message: securityMessage });
  const flowMessage = applicationFlowError(resource.type, resource.applicationFlow);
  if (flowMessage) ctx.addIssue({ code: "custom", path: ["applicationFlow"], message: flowMessage });
  const asyncMessage = asyncSettingsError(resource.type, resource.asyncQueue, resource.asyncWorker);
  if (asyncMessage) ctx.addIssue({ code: "custom", path: ["async"], message: asyncMessage });
  const breakerMessage = circuitBreakerSettingsError(resource.type, resource.circuitBreaker);
  if (breakerMessage) ctx.addIssue({ code: "custom", path: ["circuitBreaker"], message: breakerMessage });
  const message = retrySettingsError(resource.type, resource.retry);
  if (message) ctx.addIssue({ code: "custom", path: ["retry"], message });
});

const ConnectionSchema = z.object({
  id: z.string().min(1),
  sourceId: ResourceIdSchema,
  targetId: ResourceIdSchema,
  sourceType: z.string(),
  targetType: z.string(),
  port: z.number().int().min(0).max(65535),
}).catchall(z.json());

export const LayoutSchema = z.object({
  resources: z.array(ResourceSchema).default([]),
  connectionLines: z.array(ConnectionSchema).default([]),
  layoutVersion: z.number().int().positive().optional(),
  // Internal semantic review data is additive; stale drafts remain readable.
  firstStack: z.json().optional(),
}).catchall(z.json()).superRefine(validateSecurityScopes);

export const LiveTopologySchema = z.object({
  resources: z.array(ResourceSchema).min(1),
  connectionLines: z.array(ConnectionSchema),
}).superRefine(validateSecurityScopes);

function validateSecurityScopes(layout: { resources: z.infer<typeof ResourceSchema>[]; connectionLines: z.infer<typeof ConnectionSchema>[] }, ctx: z.RefinementCtx) {
  for (const [i, r] of layout.resources.entries()) {
    const message = securitySettingsError(r.type, r.listenerSettings, r.firewallSettings, layout.resources);
    if (message) ctx.addIssue({ code: "custom", path: ["resources", i, "security"], message });
    if (r.asyncWorker?.enabled && r.asyncWorker.idempotentResults === true && layout.connectionLines.some(e => e.sourceId === r.id && layout.resources.find(t => t.id === e.targetId)?.type === "Database")) ctx.addIssue({ code: "custom", path: ["resources", i, "asyncWorker", "idempotentResults"], message: "Idempotent result writes protect Object Storage only; disconnect the worker database dependency." });
  }
}
