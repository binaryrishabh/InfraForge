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
    return { ...(resource.replication ? { databaseReplication: db?.databaseReplication ?? { version: 1 as const, currentWriter: null, replicaState: null, replicaCommittedWrites: null, promotionCount: null, promotionAtUs: null, lostOperations: null, regressedKeys: null, primaryReads: null, replicaReads: null, freshReplicaReads: null, staleReplicaReads: null, primaryCommittedWrites: null, replicaAppliedWrites: null, pendingReplication: null, lagMs: null, oldestPendingAgeMs: null, primaryGeneration: null, replicaGeneration: null } } : {}), database: { version: 1, serving: state?.serving ?? null, waiting: state?.waiting ?? null, queued: state?.queued ?? null,
      rejected: state?.rejected ?? null, sessionRefused: state?.sessionRefused ?? null, "query-queue-full": db?.reasons["query-queue-full"] ?? null } };
  }
  if (resource.kind === "cache") {
    const cache = source.inspectData.cache(resource.id);
    // Coalescing belongs to application helpers. Include only helpers explicitly targeting this cache.
    const helpers = resources.filter(r => r.kind === "cache-aside" && r.cache === resource.id).map(r => source.inspectData.application(r.id)?.coalescedWaiters);
    const coalescedWaiters = helpers.length && helpers.every(n => n != null) ? helpers.reduce<number>((sum, n) => sum + n!, 0) : null;
    return { cache: { version: 1, hits: cache?.hits ?? null, misses: cache?.misses ?? null, expirations: cache?.expirations ?? null, evictions: cache?.evictions ?? null, coalescedWaiters } };
  }
  if (resource.kind === "cdn") {
    const cdn = source.inspectCdn(resource.id);
    // Individual replies can name this refusal, but there is no aggregate counter in the existing evidence.
    return { cdn: { version: 1, hits: cdn?.hits ?? null, misses: cdn?.misses ?? null, originRequests: cdn?.originRequests ?? null, fills: cdn?.fills ?? null,
      expirations: cdn?.expirations ?? null, evictions: cdn?.evictions ?? null, coalesced: cdn?.coalesced ?? null, purged: cdn?.purged ?? null, staleFills: cdn?.staleFills ?? null, "cdn-waiter-capacity": null } };
  }
  return {};
}
