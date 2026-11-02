import type { ResourceMetrics } from "@infraforge/contracts/telemetry";
import type { ResourceType } from "@infraforge/domain/resource";

const monitoring = [["generated", "Observations generated"], ["collections", "Collection attempts"], ["collectionFailures", "Unavailable observations (collection failures)"],
  ["bufferedSamples", "Buffered samples"], ["bufferedBytes", "Buffered bytes"], ["inFlightSamples", "In-flight samples"], ["inFlightBytes", "In-flight bytes"],
  ["dropped", "Local ownership discards (all)"], ["droppedBeforeExport", "Dropped before export"], ["exported", "Confirmed exported observations"],
  ["batches", "Export batches attempted"], ["failedBatches", "Failed export batches"], ["discardedUnconfirmed", "Discarded unconfirmed observations"]] as const;
const objects = [["storedBytes", "Stored bytes"], ["capacityBytes", "Capacity bytes"], ["committedPuts", "Committed puts"], ["replacedObjects", "Replaced objects"],
  ["removedObjects", "Removed objects"], ["deletes", "Delete operations"], ["object-capacity", "Object capacity refusals"]] as const;
const text = (value: number | string | null | undefined) => value == null ? "Unknown" : String(value);

export function ObservabilityReadings({ type, metrics }: { type: ResourceType; metrics?: ResourceMetrics }) {
  const rows = type === "Monitoring Agent" ? monitoring : type === "Object Storage" ? objects : undefined;
  if (!rows) return null;
  const values = type === "Monitoring Agent" ? metrics?.monitoring : metrics?.objectStorage;
  const readings: Partial<Record<string, unknown>> = values?.version === 1 ? { ...values } : {};
  const freshness = metrics?.monitoring?.version === 1 ? metrics.monitoring.freshness : null;
  return <section aria-label={`${type} measurements`} className="border-b border-line px-4 py-4 text-sm">
    <p className="mb-2 text-xs text-ink-3">Model 2 evidence. Populations are current; counters accumulate since this run began.</p>
    <dl>{rows.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{text(readings[key] as number | null | undefined)}</dd></div>)}</dl>
    {type === "Monitoring Agent" && <>
      <p>Missing observation does not establish application failure. Backend arrival may have occurred without confirmation for discarded unconfirmed observations.</p>
      {freshness?.length ? freshness.map(row => <div key={row.target}><p>Target: {row.target}</p><dl>
        <div><dt>Measurement timestamp (us)</dt><dd>{text(row.measuredAt)}</dd></div>
        <div><dt>Observation age (us)</dt><dd>{text(row.ageUs)}</dd></div>
        <div><dt>Observation freshness</dt><dd>{text(row.state)}</dd></div>
      </dl></div>) : <p>Observation freshness: Unknown</p>}
    </>}
  </section>;
}
