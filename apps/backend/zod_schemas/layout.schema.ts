import * as z from "zod";
import { objectStoragePolicyError, OBJECT_STORAGE_CAPACITY_MAX_MIB, monitoringPolicyError, MONITORING_BUFFER_MAX_SAMPLES, MONITORING_EXPORT_MAX_ATTEMPTS, MONITORING_CADENCE_MAX_SECONDS, cdnCachePolicyError, CDN_MAX_WAITERS, CDN_TTL_MAX_SECONDS, vmCpuQuotaError, VM_CPU_LIMIT_MAX, VM_WORKERS_MAX, VM_QUEUED_REQUESTS_MAX, vmExecutionError, LB_HEALTH_SECONDS_MAX, LB_HEALTH_THRESHOLD_MAX, lbHealthError, LB_ACTIVE_MAX, LB_QUEUED_MAX, LB_QUEUE_WAIT_MAX_MS, DB_ACTIVE_QUERIES_MAX, DB_QUEUED_QUERIES_MAX, lbAdmissionError, dbConcurrencyError, CACHE_TTL_MAX_SECONDS, CACHE_CAPACITY_MAX_ENTRIES, cachePolicyError, DATA_KEYSPACE_MAX, dataKeyspaceError, securitySettingsError, applicationFlowError, asyncSettingsError, circuitBreakerSettingsError, RESOURCE_TYPES, RETRY_GROUPS, retrySettingsError } from "@infraforge/domain/resource";

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
  id: ResourceIdSchema,
  type: z.enum(RESOURCE_TYPES),
  x: z.number(),
  y: z.number(),
  skuId: z.string().optional(),
  cachePolicy: CachePolicySchema.optional(),
  objectStoragePolicy: z.object({ version: z.literal(1), capacityMiB: z.number().int().min(1).max(OBJECT_STORAGE_CAPACITY_MAX_MIB) }).strict().optional(),
  monitoringPolicy: z.discriminatedUnion("version", [
    z.object({ version: z.literal(1), collectionIntervalSeconds: z.number().int().min(1).max(MONITORING_CADENCE_MAX_SECONDS).optional(), exportIntervalSeconds: z.number().int().min(1).max(MONITORING_CADENCE_MAX_SECONDS).optional() }).strict(),
    z.object({ version: z.literal(2), collectionIntervalSeconds: z.number().int().min(1).max(MONITORING_CADENCE_MAX_SECONDS).optional(), exportIntervalSeconds: z.number().int().min(1).max(MONITORING_CADENCE_MAX_SECONDS).optional(), bufferSamples: z.number().int().min(1).max(MONITORING_BUFFER_MAX_SAMPLES), batchSamples: z.number().int().min(1).max(MONITORING_BUFFER_MAX_SAMPLES), exportAttempts: z.number().int().min(1).max(MONITORING_EXPORT_MAX_ATTEMPTS) }).strict(),
  ]).optional(),
  cdnCachePolicy: z.union([
    z.object({ version: z.literal(1), ttlSeconds: z.number().int().min(1).max(CDN_TTL_MAX_SECONDS) }).strict(),
    z.object({ version: z.literal(2), ttlSeconds: z.number().int().min(1).max(CDN_TTL_MAX_SECONDS).optional(), coalesce: z.boolean(), maxWaiters: z.number().int().min(1).max(CDN_MAX_WAITERS).optional() }).strict(),
  ]).optional(),
  lbHealth: z.object({ version: z.literal(1), intervalSeconds: z.number().int().min(1).max(LB_HEALTH_SECONDS_MAX).optional(), timeoutSeconds: z.number().int().min(1).max(LB_HEALTH_SECONDS_MAX).optional(), unhealthyAfter: z.number().int().min(1).max(LB_HEALTH_THRESHOLD_MAX).optional(), healthyAfter: z.number().int().min(1).max(LB_HEALTH_THRESHOLD_MAX).optional() }).strict().optional(),
  lbAdmission: z.object({ version: z.literal(1), maxActive: z.number().int().min(1).max(LB_ACTIVE_MAX).optional(), maxQueued: z.number().int().min(0).max(LB_QUEUED_MAX).optional(), queueWaitMs: z.number().int().min(1).max(LB_QUEUE_WAIT_MAX_MS).optional() }).strict().optional(),
  vmCpuQuota: z.object({ version: z.literal(1), limitPercent: z.number().int().min(1).max(VM_CPU_LIMIT_MAX) }).strict().optional(),
  vmExecution: z.object({ version: z.literal(1), workers: z.number().int().min(1).max(VM_WORKERS_MAX).optional(), queuedRequests: z.number().int().min(0).max(VM_QUEUED_REQUESTS_MAX).optional() }).strict().optional(),
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
  const objectMessage = objectStoragePolicyError(resource.type, resource.objectStoragePolicy);
  if (objectMessage) ctx.addIssue({ code: "custom", path: ["objectStoragePolicy"], message: objectMessage });
  const monitoringMessage = monitoringPolicyError(resource.type, resource.monitoringPolicy);
  if (monitoringMessage) ctx.addIssue({ code: "custom", path: ["monitoringPolicy"], message: monitoringMessage });
  const cdnMessage = cdnCachePolicyError(resource.type, resource.cdnCachePolicy);
  if (cdnMessage) ctx.addIssue({ code: "custom", path: ["cdnCachePolicy"], message: cdnMessage });
  const healthMessage = lbHealthError(resource.type, resource.lbHealth);
  if (healthMessage) ctx.addIssue({ code: "custom", path: ["lbHealth"], message: healthMessage });
  const lbMessage = lbAdmissionError(resource.type, resource.lbAdmission);
  if (lbMessage) ctx.addIssue({ code: "custom", path: ["lbAdmission"], message: lbMessage });
  const quotaMessage = vmCpuQuotaError(resource.type, resource.vmCpuQuota, resource.asyncWorker?.enabled);
  if (quotaMessage) ctx.addIssue({ code: "custom", path: ["vmCpuQuota"], message: quotaMessage });
  const executionMessage = vmExecutionError(resource.type, resource.vmExecution, resource.asyncWorker?.enabled);
  if (executionMessage) ctx.addIssue({ code: "custom", path: ["vmExecution"], message: executionMessage });
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
