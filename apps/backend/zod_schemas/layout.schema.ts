import * as z from "zod";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";

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
  public: z.boolean().optional(),
  encryption: z.boolean().optional(),
  openPorts: z.array(z.number().int().min(0).max(65535)).optional(),
  size: z.enum(["small", "medium", "large"]).optional(),
  region: z.string().optional(),
  name: z.string().optional(),
}).catchall(z.json());

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
}).catchall(z.json());

export const LiveTopologySchema = z.object({
  resources: z.array(ResourceSchema).min(1),
  connectionLines: z.array(ConnectionSchema),
});
