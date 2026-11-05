import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(4000);
const edge = z.object({
  path: id, source: id, target: id,
  admitted: count.nullable(), denied: count.nullable(), noListener: count.nullable(), backendDeliveries: count.nullable(),
  requestDenied: count.optional(),
  policyDenied: z.record(id, count).refine(v => Object.keys(v).length <= 2000).nullable(),
  lastDenial: z.object({connectionId: id, source: id, target: id, port: count.min(1).max(65535), reason: id, generation: count.optional()}).optional(),
}).refine(e => e.denied === null || e.noListener === null || e.policyDenied === null ||
  Number.isSafeInteger(Object.values(e.policyDenied).reduce((a, b) => a + b, e.noListener)) &&
  Object.values(e.policyDenied).reduce((a, b) => a + b, e.noListener) <= e.denied);

// Optional for historical reports. Exact counters survive omitted detail rows;
// missing counters remain null and cannot satisfy a new requirement.
export const SecurityMetricsSchema = z.object({
  version: z.literal(1), evidence: z.enum(["complete", "omitted"]), omitted: count.optional(),
  edges: z.array(edge).max(4096),
  firewall: z.object({
    occupancy: count, limit: count.min(1), admissions: count, generation: count.min(1),
    policyDenied: count.nullable().optional(), "flow-capacity": count.nullable().optional(),
    expired: count.optional(), establishedRequests: count.optional(), newRequests: count.optional(), expiredReturns: count.optional(),
  }).refine(f => f.occupancy <= f.limit && f.occupancy <= f.admissions).optional(),
}).transform(s => s.evidence === "omitted" ? {...s, edges: s.edges.map(({lastDenial: _detail, ...edge}) => edge)} : s);
