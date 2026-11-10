import { z } from "zod";
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const DnsPublicationEvidenceSchema = z.object({
  authorityId: z.string().min(1).max(64), resolverId: z.string().min(1).max(256),
  name: z.literal("app.example"), initialRecord: z.literal("absent"),
  publishedAtUs: count.nullable(), updates: count.max(1).nullable(), negativeResponses: count.nullable(),
  negativeCacheHits: count.nullable(), firstSuccessfulResolutionAtUs: count.nullable(), unresolvedConnections: count.nullable(),
  currentRecord: z.object({generation: z.literal(2), addresses: z.array(z.string().min(1).max(64)).length(1), ttlUs: z.literal(60_000_000)}).strict().nullable(),
}).strict().refine(e => e.resolverId === `${e.authorityId}/resolver` &&
  (e.publishedAtUs === null ? e.currentRecord === null && (e.updates === null || e.updates === 0) : e.currentRecord !== null && (e.updates === null || e.updates === 1)) &&
  (e.firstSuccessfulResolutionAtUs === null || (e.publishedAtUs !== null && e.firstSuccessfulResolutionAtUs >= e.publishedAtUs)), "Publication, current record and resolution must agree");
