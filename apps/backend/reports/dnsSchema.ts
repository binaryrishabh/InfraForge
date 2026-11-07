import { z } from "zod";

const amount = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const count = amount.int();
const id = z.string().min(1).max(256);
const name = z.string().min(1).max(253);
const answer = z.object({ok: z.boolean(), name, authority: id,
  reason: z.string().min(1).max(1024).nullable(), generation: count.nullable(), expiresAt: amount.nullable(),
  addresses: z.array(z.string().min(1).max(1024)).max(64).nullable(), addressesOmitted: count.nullable(),
}).strict();
const entry = z.object({name, expiresAt: amount, answer}).strict()
  .refine(e => e.name === e.answer.name && e.expiresAt === e.answer.expiresAt, "Cached answer identity and expiry must agree");
const resolver = z.object({id,
  queries: count.nullable(), hits: count.nullable(), misses: count.nullable(), authoritativeLookups: count.nullable(),
  failures: count.nullable(), fills: count.nullable(), expirations: count.nullable(), evictions: count.nullable(), replaced: count.nullable(),
  cache: z.array(entry).max(64), cacheOmitted: count,
}).strict().refine(r => new Set(r.cache.map(c => c.name)).size === r.cache.length, "Cached names must be unique per resolver");
export const DnsEvidenceSchema = z.object({version: z.literal(1), fromUs: z.literal(0), throughUs: amount,
  timestampComplete: z.boolean().nullable(), resolvers: z.array(resolver).max(64), resolversOmitted: count,
}).strict().refine(e => new Set(e.resolvers.map(r => r.id)).size === e.resolvers.length, "Resolver identities must be unique");
