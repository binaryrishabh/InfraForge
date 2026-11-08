import type { DnsEvidence } from "@infraforge/contracts/reports";
import { DnsEvidenceSchema } from "../reports/dnsSchema";

/** Copy only resolver-owned evidence. Internal engine runs use the same read boundary. */
interface Source {
  capture: {throughUs: number; timestampComplete?: boolean};
  systems: {resolvers: Array<{
    id: string; queries: number; hits: number; misses: number; authoritativeLookups: number;
    failures: number; fills: number; expirations: number; evictions: number; replaced: number;
    cache: Array<{name: string; expiresAt: number; answer: {ok: boolean; name: string; authority: string;
      reason?: string; generation?: number; expiresAt?: number; addresses?: string[]}}>;
  }>};
}
export function dnsSnapshot(e: Source): DnsEvidence {
  return DnsEvidenceSchema.parse({version: 1, fromUs: 0, throughUs: e.capture.throughUs,
    timestampComplete: e.capture.timestampComplete ?? null,
    resolvers: e.systems.resolvers.slice(0, 64).map(r => ({id: r.id,
      queries: r.queries, hits: r.hits, misses: r.misses, authoritativeLookups: r.authoritativeLookups,
      failures: r.failures, fills: r.fills, expirations: r.expirations, evictions: r.evictions, replaced: r.replaced,
      cache: r.cache.slice(0, 64).map(c => ({name: c.name, expiresAt: c.expiresAt,
        answer: {ok: c.answer.ok, name: c.answer.name, authority: c.answer.authority,
          reason: c.answer.reason ?? null, generation: c.answer.generation ?? null, expiresAt: c.answer.expiresAt ?? null,
          addresses: c.answer.addresses?.slice(0, 64) ?? null,
          addressesOmitted: c.answer.addresses ? Math.max(0, c.answer.addresses.length - 64) : null}})),
      cacheOmitted: Math.max(0, r.cache.length - 64)})),
    resolversOmitted: Math.max(0, e.systems.resolvers.length - 64)});
}
