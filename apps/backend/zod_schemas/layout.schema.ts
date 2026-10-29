import * as z from "zod";
import { asyncSettingsError, circuitBreakerSettingsError, RESOURCE_TYPES, RETRY_GROUPS, retrySettingsError } from "@infraforge/domain/resource";

const ResourceIdSchema = z.string().min(1).refine(
  (id) => !Object.hasOwn(Object.prototype, id),
  "Resource IDs cannot use reserved object property names",
);

const ResourceSchema = z.object({
  id: ResourceIdSchema,
  type: z.enum(RESOURCE_TYPES),
  x: z.number(),
  y: z.number(),
  skuId: z.string().optional(),
  autoscaling: z.object({
    enabled: z.boolean().optional(),
    minReplicas: z.number().int().positive().optional(),
    maxReplicas: z.number().int().positive().optional(),
    targetCpu: z.number().min(0).max(100).optional(),
  }).optional(),
  asyncQueue: z.object({ enabled: z.boolean(), visibilityTimeoutSeconds: z.number().optional(), maxReceives: z.number().optional(), retentionSeconds: z.number().optional() }).strict().optional(),
  asyncWorker: z.object({ enabled: z.boolean(), concurrency: z.number().optional(), prefetch: z.number().optional(), cpuMsPerJob: z.number().optional() }).strict().optional(),
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
}).catchall(z.json());

export const LiveTopologySchema = z.object({
  resources: z.array(ResourceSchema).min(1),
  connectionLines: z.array(ConnectionSchema),
});
