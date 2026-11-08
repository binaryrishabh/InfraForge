import type { DnsEvidence } from "@infraforge/contracts/reports";

const value = (n: number | boolean | string | null | undefined) => n == null ? "Unknown" : String(n);
const counters = [["queries", "DNS: Resolver queries"], ["hits", "DNS: Cache hits"], ["misses", "DNS: Cache misses"],
  ["authoritativeLookups", "DNS: Authoritative lookups"], ["failures", "DNS: Lookup failures"], ["fills", "DNS: Cache fills"],
  ["expirations", "DNS: Cache expirations"], ["evictions", "DNS: Cache evictions"], ["replaced", "DNS: Cache replacements"]] as const;

export function DnsReadings({evidence: e}: {evidence?: DnsEvidence}) {
  return <section aria-label="DNS resolver measurements" className="mt-4 text-sm">
    <h3 className="font-semibold">DNS resolver measurements</h3>
    <p className="text-xs text-ink-3">Counters are cumulative from run start through the recorded boundary (counts). Cache rows are current at that boundary. Times are absolute simulated microseconds (us) from run start, not remaining lifetimes.</p>
    <dl><dt>DNS: Through time</dt><dd>{value(e?.throughUs)}</dd>
      <dt>Complete DNS timestamp</dt><dd>{value(e?.timestampComplete)}</dd>
      <dt>Omitted resolvers (count)</dt><dd>{value(e?.resolversOmitted)}</dd></dl>
    {e?.resolvers.length === 0 && <p>No resolver was recorded in this capture.</p>}
    {(e?.resolvers.length ? e.resolvers : [null]).map((r, i) => <div key={r?.id ?? i}>
      <h4>{r?.id ?? "Resolver: Unknown"}</h4>
      <dl>{counters.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(r?.[key])}</dd></div>)}
        <dt>Omitted cache entries (count)</dt><dd>{value(r?.cacheOmitted)}</dd></dl>
      {r?.cache.length === 0 && <p>No cached answer was recorded for this resolver.</p>}
      {(r?.cache.length ? r.cache : [null]).map((c, j) => <div key={c?.name ?? j}>
        <h5>{c?.name ?? "Cached name: Unknown"}</h5>
        <dl><dt>DNS: Cached answer expiry</dt><dd>{value(c?.expiresAt)}</dd>
          <dt>DNS: Cached answer generation</dt><dd>{value(c?.answer.generation)}</dd>
          <dt>DNS: Cached answer success</dt><dd>{value(c?.answer.ok)}</dd>
          <dt>DNS: Cached answer authority</dt><dd>{value(c?.answer.authority)}</dd>
          <dt>DNS: Cached answer reason</dt><dd>{value(c?.answer.reason)}</dd>
          <dt>Cached addresses</dt><dd>{c?.answer.addresses?.join(", ") ?? "Unknown"}</dd>
          <dt>Omitted addresses (count)</dt><dd>{value(c?.answer.addressesOmitted)}</dd></dl>
      </div>)}
    </div>)}
    <p className="text-xs text-ink-3">Hits include reusable negative answers; lookup failures include negative answers. Expirations, evictions (including clear) and replacements are distinct counters, not a timestamped transition history. A missing cached generation or omitted answer is Unknown. DNS success does not establish application reachability, continuous health, failover or recovery time.</p>
  </section>;
}
