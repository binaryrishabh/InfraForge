import { databaseReplicationLive } from "./databaseReplicationLive";
import type { ResourceMetrics } from "@infraforge/contracts/telemetry";
import type { CompiledProduct } from "./contracts";
import type { createProductModel2 } from "./run";

type Runtime = ReturnType<typeof createProductModel2>;
type Source = Pick<Runtime, "inspectData" | "inspectCdn">;
type Readings = Pick<ResourceMetrics, "databaseReplication" | "database" | "cache" | "cdn">;

// Select the same resource-owned evidence used by official results. No retained result history is counted.
export function dataDeliveryLive(resource: CompiledProduct["input"]["resources"][number], source: Source, current: unknown, resources: CompiledProduct["input"]["resources"]): Readings {
  if (resource.kind === "relational") {
    const db = source.inspectData.database(resource.id);
    const state = current as { serving?: number; waiting?: number; queued?: number; rejected?: number; sessionRefused?: number } | undefined;
    return { ...(resource.replication ? { databaseReplication: databaseReplicationLive(db?.databaseReplication) } : {}), database: { ...(db?.databaseReadRouting ? { readRouting: db.databaseReadRouting } : {}), version: 1, serving: state?.serving ?? null, waiting: state?.waiting ?? null, queued: state?.queued ?? null,
      rejected: state?.rejected ?? null, sessionRefused: state?.sessionRefused ?? null, "query-queue-full": db?.reasons["query-queue-full"] ?? null,
      // Present only with a saved row lock order. A database that has not reported its lock manager is Unknown (null); a reported none is 0.
      ...(resource.rowLocking ? { deadlocks: db?.locks ? db.locks.deadlocks : null, lockWaits: db?.locks ? db.locks.waits : null, deadlockVictims: db?.reasons ? db.reasons["deadlock-requester-victim"] ?? 0 : null } : {}) } };
  }
  if (resource.kind === "cache") {
    const cache = source.inspectData.cache(resource.id);
    // Coalescing belongs to application helpers. Include only helpers explicitly targeting this cache.
    const helpers = resources.filter(r => r.kind === "cache-aside" && r.cache === resource.id).map(r => source.inspectData.application(r.id)?.coalescedWaiters);
    const coalescedWaiters = helpers.length && helpers.every(n => n != null) ? helpers.reduce<number>((sum, n) => sum + n!, 0) : null;
    // Freshness counters exist only for marked helpers; a helper that did not record them, or could not compare a hit, leaves the cache's counters Unknown (null).
    const fresh = resources.filter(r => r.kind === "cache-aside" && r.cache === resource.id).map(r => source.inspectData.application(r.id)?.freshness);
    const marked = fresh.some(f => f !== undefined), known = marked && fresh.every(f => f !== undefined && f.unobserved === 0);
    const negative = resources.filter(r => r.kind === "cache-aside" && r.cache === resource.id).map(r => source.inspectData.application(r.id)?.negative);
    const negativeKnown = negative.length > 0 && negative.every(n => n !== undefined);
    const sumNegative = (key: "absentAnswers" | "negativeHits" | "absentSourceReads") => negativeKnown ? negative.reduce((sum, n) => sum + n![key], 0) : null;
    return { cache: { version: 1, hits: cache?.hits ?? null, misses: cache?.misses ?? null, expirations: cache?.expirations ?? null, evictions: cache?.evictions ?? null, coalescedWaiters,
      ...(resource.negativeTtl !== undefined ? { absentAnswers: sumNegative("absentAnswers"), negativeHits: sumNegative("negativeHits"), absentSourceReads: sumNegative("absentSourceReads") } : {}),
      ...(marked ? { outdatedHits: known ? fresh.reduce((sum, f) => sum + f!.outdatedHits, 0) : null, maxVersionsBehind: known ? fresh.reduce((max, f) => Math.max(max, f!.maxVersionsBehind), 0) : null } : {}),
      ...(cache && "staleServed" in cache ? { staleServed: (cache as { staleServed: number }).staleServed, maxStaleAgeUs: (cache as { maxStaleAgeUs: number | null }).maxStaleAgeUs } : {}) } };
  }
  if (resource.kind === "cdn") {
    const cdn = source.inspectCdn(resource.id);
    // Individual replies can name this refusal, but there is no aggregate counter in the existing evidence.
    return { cdn: { version: 1, hits: cdn?.hits ?? null, misses: cdn?.misses ?? null, originRequests: cdn?.originRequests ?? null, fills: cdn?.fills ?? null,
      expirations: cdn?.expirations ?? null, evictions: cdn?.evictions ?? null, coalesced: cdn?.coalesced ?? null, purged: cdn?.purged ?? null, staleFills: cdn?.staleFills ?? null, "cdn-waiter-capacity": null } };
  }
  return {};
}
