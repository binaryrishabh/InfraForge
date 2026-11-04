import type { ResourceMetrics } from "@infraforge/contracts/telemetry";
import type { ResourceType } from "@infraforge/domain/resource";

const database = [["serving", "Serving queries"], ["waiting", "Queries waiting for locks"], ["queued", "Queued queries"], ["rejected", "Rejected queries (all reasons)"], ["sessionRefused", "Refused session opens"], ["query-queue-full", "Query queue full refusals"]] as const;
const cache = [["hits", "Cache hits"], ["misses", "Cache misses"], ["expirations", "Cache expirations"], ["evictions", "Cache evictions"], ["coalescedWaiters", "Coalesced waiters (application helpers)"]] as const;
const cdn = [["hits", "CDN hits"], ["misses", "CDN misses"], ["originRequests", "Origin requests"], ["fills", "CDN fills"], ["expirations", "CDN expirations"], ["evictions", "CDN evictions"], ["coalesced", "Coalesced requests"], ["cdn-waiter-capacity", "CDN waiter capacity refusals"], ["purged", "Purged entries"], ["staleFills", "Stale fills prevented"]] as const;

export function DataDeliveryReadings({ type, metrics }: { type: ResourceType; metrics?: ResourceMetrics }) {
  const rows = type === "Database" ? database : type === "Cache" ? cache : type === "CDN" ? cdn : undefined;
  const values = type === "Database" ? metrics?.database : type === "Cache" ? metrics?.cache : metrics?.cdn;
  if (!rows) return null;
  const readings: Partial<Record<string, number | null>> = values?.version === 1 ? Object.fromEntries(Object.entries(values).filter(([, value]) => value === null || typeof value === "number")) : {};
  return <section aria-label={`${type} measurements`} className="border-b border-line px-4 py-4 text-sm">
    <p className="mb-2 text-xs text-ink-3">Model 2 evidence. Query populations are current; counters accumulate since this run began.</p>
    <dl>{rows.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{readings[key] == null ? "Unknown" : String(readings[key])}</dd></div>)}</dl>
  </section>;
}
