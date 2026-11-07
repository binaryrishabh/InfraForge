import type { ReportCheckpoint } from "@infraforge/contracts/reports";

const rows = [["hits", "CDN: Hits"], ["misses", "CDN: Misses"], ["originRequests", "CDN: Origin requests"],
  ["fills", "CDN: Stored fills"],
  ["expirations", "CDN: Expirations"], ["evictions", "CDN: Evictions"], ["coalesced", "CDN: Coalesced waiters"],
  ["purged", "CDN: Purged entries"], ["staleFills", "CDN: Stale fills fenced"],
  ["cdn-waiter-capacity", "CDN: Waiter capacity refusals"]] as const;

export function CdnReadings({ resource }: { resource: ReportCheckpoint["resources"][number] }) {
  const cdn = resource.cdn?.version === 1 ? resource.cdn : undefined;
  return <section aria-label={`CDN measurements for ${resource.id}`} className="mt-4 text-sm">
    <h3 className="font-semibold">{resource.id}: CDN measurements</h3>
    <p className="text-xs text-ink-3">Counters are cumulative from run start through this snapshot. All values are counts, including modeled internal requests.</p>
    <dl>{rows.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{cdn?.[key] == null ? "Unknown" : String(cdn[key])}</dd></div>)}</dl>
    <p className="text-xs text-ink-3">Origin requests count fetches; coalesced waiters count additional requests joining an existing fetch. Neither population is original callers. Stored fills count cache insertions, not responses. Stale fills fenced count successful origin replies prevented from entering the cache after invalidation; their waiters can still receive those replies.</p>
    <p className="text-xs text-ink-3">Purge epochs: Unknown. The engine uses internal epoch and key-generation fences, but does not expose their values. Purged entries count removed entries, not purge actions. Waiter capacity refusals have no aggregate engine counter and stay Unknown. Missing saved evidence stays Unknown.</p>
  </section>;
}
