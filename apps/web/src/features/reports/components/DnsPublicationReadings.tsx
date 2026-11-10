import type { DnsEvidence } from "@infraforge/contracts/reports";
const value = (n: unknown) => n == null ? "Unknown" : String(n);
export function DnsPublicationReadings({publication: p}: Pick<DnsEvidence, "publication">) {
  if (!p) return null;
  return <section aria-label="DNS publication measurements">
    <h4>DNS publication measurements</h4>
    <p>Single authored name {p.name}; authority {p.authorityId}; resolver {p.resolverId}. Times are deterministic simulated microseconds from run start.</p>
    <dl>
      <dt>DNS: Initial record</dt><dd>{p.initialRecord}</dd>
      <dt>DNS: Published at</dt><dd>{value(p.publishedAtUs)}</dd>
      <dt>DNS: Authority updates</dt><dd>{value(p.updates)}</dd>
      <dt>DNS: Authority negative responses</dt><dd>{value(p.negativeResponses)}</dd>
      <dt>DNS: Current record generation</dt><dd>{value(p.currentRecord?.generation)}</dd>
      <dt>Current record address</dt><dd>{p.currentRecord?.addresses.join(", ") ?? "Unknown"}</dd>
      <dt>DNS: Negative cache hits</dt><dd>{value(p.negativeCacheHits)}</dd>
      <dt>DNS: First successful resolution</dt><dd>{value(p.firstSuccessfulResolutionAtUs)}</dd>
      <dt>DNS: Unresolved connections</dt><dd>{value(p.unresolvedConnections)}</dd>
    </dl>
    <p>A published record does not invalidate a cached negative answer. Current record is observed at this boundary; missing publication or resolution times stay Unknown. Unresolved connections count failed opens, separately from authority responses. No internet propagation or established-connection migration is modeled.</p>
  </section>;
}
