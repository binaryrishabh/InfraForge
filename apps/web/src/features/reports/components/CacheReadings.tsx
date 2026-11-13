import type { ReportCheckpoint } from "@infraforge/contracts/reports";

type Resource = ReportCheckpoint["resources"][number];
const cacheRows = [["hits", "Cache: Hits"], ["misses", "Cache: Misses"], ["expirations", "Cache: Expirations"],
  ["evictions", "Cache: Evictions"], ["coalescedWaiters", "Cache: Targeting-helper coalesced waiters"],
  ["staleServed", "Cache: Stale answers served"], ["maxStaleAgeUs", "Cache: Oldest stale answer past expiry (us)"],
  ["outdatedHits", "Cache: Hits behind the database"], ["maxVersionsBehind", "Cache: Most versions behind"]] as const;
// Rows that appear only when the saved setting that records them was present.
const conditional = { staleServed: "staleServed", maxStaleAgeUs: "staleServed", outdatedHits: "outdatedHits", maxVersionsBehind: "outdatedHits" } as const;
const helperRows = [["received", "Application helper: Received"], ["completed", "Application helper: Completed"],
  ["failed", "Application helper: Failed"], ["live", "Application helper: Live requests"],
  ["databaseFetches", "Application helper: Database fetches"], ["cacheFailures", "Application helper: Cache failures"],
  ["coalescedWaiters", "Application helper: Coalesced waiters"], ["fillsInProgress", "Application helper: Fills in progress"],
  ["invalidations", "Application helper: Invalidations"]] as const;
const value = (n: number | null | undefined) => n == null ? "Unknown" : String(n);

export function CacheReadings({ resource, cache }: { resource: Resource; cache: boolean }) {
  const helpers = resource.applicationHelpers?.version === 1 ? resource.applicationHelpers.helpers : undefined;
  return <section aria-label={`Cache and helper measurements for ${resource.id}`} className="mt-4 text-sm">
    <h3 className="font-semibold">{resource.id}: cache and helper measurements</h3>
    <p className="text-xs text-ink-3">Counters are cumulative counts from run start through this snapshot, including modeled internal work; they are separate from original callers and final-second requests/s. Live requests and fills in progress are current counts.</p>
    {cache && <dl>{cacheRows.filter(([key]) => !(key in conditional) || (resource.cache?.version === 1 && resource.cache[conditional[key as keyof typeof conditional]] !== undefined)).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(resource.cache?.version === 1 ? resource.cache[key] : undefined)}</dd></div>)}</dl>}
    {cache && <p className="text-xs text-ink-3">Targeting-helper coalesced waiters sums helpers explicitly targeting this cache. It is not a cache command count; the same waiters appear under their helper owners.</p>}
    {(helpers?.length || !cache) && (helpers?.length ? helpers.map(helper => <div key={helper.id}>
      <h4 className="font-medium">Helper {helper.id}</h4><p>Cache {helper.cacheId}; database {helper.databaseId}</p>
      <dl>{helperRows.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(helper[key])}</dd></div>)}</dl>
    </div>) : <div><p>Application helpers: Unknown</p><dl>{helperRows.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>Unknown</dd></div>)}</dl></div>)}
    <p className="text-xs text-ink-3">Database fetches include helper reads and writes, including failure fallback. Each helper coordinates independently. These counts prove neither a caller hit ratio nor mutable-data correctness. Missing evidence stays Unknown.</p>
  </section>;
}
