import { requireKnown, type Quantity } from "@infraforge/simulation/internal-product";
import type { DnsEvidence } from "@infraforge/contracts/reports";
export interface PublicationSource {
  authorities?: Array<{id: string; updates: number; negative: number;
    publication?: {version: 1; initialRecord: "absent"; name: string; publishedAtUs: number | null};
    records: Array<{name: string; generation: number; addresses: string[]; ttl: Quantity<"us">}>}>;
  resolvers: Array<{id: string; negativeHits?: number; firstSuccessfulResolutionAtUs?: number | null}>;
  security?: {dnsFailed: number};
}
export function dnsPublicationSnapshot(systems: PublicationSource): Pick<DnsEvidence, "publication"> {
  const marked = systems.authorities?.filter(a => a.publication) ?? [];
  if (!marked.length) return {};
  if (marked.length !== 1) throw Error("DNS publication evidence requires one marked authority");
  const authority = marked[0]!, publication = authority.publication!, resolver = systems.resolvers.find(r => r.id === `${authority.id}/resolver`);
  if (publication.name !== "app.example") throw Error("Unknown publication name");
  const current = authority.records.find(r => r.name === publication.name);
  return {publication: {authorityId: authority.id, resolverId: `${authority.id}/resolver`, name: "app.example", initialRecord: publication.initialRecord,
    publishedAtUs: publication.publishedAtUs, updates: authority.updates ?? null, negativeResponses: authority.negative ?? null,
    negativeCacheHits: resolver?.negativeHits ?? null, firstSuccessfulResolutionAtUs: resolver?.firstSuccessfulResolutionAtUs ?? null,
    unresolvedConnections: systems.security?.dnsFailed ?? null,
    currentRecord: current ? {generation: current.generation, addresses: [...current.addresses], ttlUs: requireKnown(current.ttl, "us")} : null}};
}
