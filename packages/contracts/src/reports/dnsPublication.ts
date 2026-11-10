/** Opt-in single-name publication observations, through the enclosing DNS boundary. */
export interface DnsPublicationEvidence {
  authorityId: string;
  resolverId: string;
  name: "app.example";
  initialRecord: "absent";
  publishedAtUs: number | null;
  updates: number | null;
  negativeResponses: number | null;
  negativeCacheHits: number | null;
  firstSuccessfulResolutionAtUs: number | null;
  unresolvedConnections: number | null;
  currentRecord: {generation: number; addresses: string[]; ttlUs: number} | null;
}
