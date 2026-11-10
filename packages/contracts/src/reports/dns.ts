/** Resolver-owned counters since run start and cache state at the captured boundary.
 * No transition history, authority configuration or application health is inferred. */
export interface DnsEvidence {
  publication?: import("./dnsPublication").DnsPublicationEvidence;
  version: 1;
  fromUs: 0;
  throughUs: number;
  timestampComplete: boolean | null;
  resolvers: Array<{
    id: string;
    queries: number | null;
    hits: number | null;
    misses: number | null;
    authoritativeLookups: number | null;
    failures: number | null;
    fills: number | null;
    expirations: number | null;
    evictions: number | null;
    replaced: number | null;
    cache: Array<{
      name: string;
      expiresAt: number;
      answer: {
        ok: boolean;
        name: string;
        authority: string;
        reason: string | null;
        generation: number | null;
        expiresAt: number | null;
        addresses: string[] | null;
        addressesOmitted: number | null;
      };
    }>;
    cacheOmitted: number;
  }>;
  resolversOmitted: number;
}
