import type { ReportCheckpoint } from "@infraforge/contracts/reports";

const rows = [["generated", "Monitoring: Generated samples"], ["collections", "Monitoring: Collection requests"],
  ["collectionFailures", "Monitoring: Collection failures"], ["exported", "Monitoring: Confirmed exports"],
  ["dropped", "Monitoring: Local ownership discarded"], ["droppedBeforeExport", "Monitoring: Dropped before export"],
  ["discardedUnconfirmed", "Monitoring: Discarded unconfirmed"], ["batches", "Monitoring: Export batches"],
  ["failedBatches", "Monitoring: Failed batches"], ["bufferedSamples", "Monitoring: Buffered samples"],
  ["bufferedBytes", "Monitoring: Buffered bytes"], ["inFlightSamples", "Monitoring: Samples in flight"],
  ["inFlightBytes", "Monitoring: Bytes in flight"]] as const;
const backendRows = [["received", "Monitoring backend: Received samples"], ["duplicates", "Monitoring backend: Duplicate samples"],
  ["refused", "Monitoring backend: Refused batches"]] as const;
const value = (v: string | number | null | undefined) => v == null ? "Unknown" : String(v);

export function MonitoringReadings({resource}: {resource: ReportCheckpoint["resources"][number]}) {
  const m = resource.monitoring, b = resource.monitoringBackend;
  return <section aria-label={`Monitoring measurements for ${resource.id}`} className="mt-4 text-sm">
    <h3 className="font-semibold">{resource.id}: monitoring measurements</h3>
    <p className="text-xs text-ink-3">Counters are cumulative from run start through this snapshot. Buffer and in-flight values are current occupancy; byte fields are bytes, other counters are counts.</p>
    <dl>{rows.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(m?.[key])}</dd></div>)}</dl>
    <p className="text-xs text-ink-3">Confirmed exports count samples acknowledged to the collector. Dropped before export means local buffer refusal. Discarded unconfirmed means local ownership ended after failed attempts; the backend may already have received those samples. Local ownership discarded is the sum of those two loss counters, not an additional population.</p>
    <p className="text-xs text-ink-3">Collector freshness follows successful collection, even when the new sample was dropped. Ages and times below are simulated microseconds. Missing age is Unknown, never zero. A fresh sample does not prove a complete history or application health.</p>
    <dl>{(m?.freshness?.length ? m.freshness : [null]).map((r, i) => <div key={i}>
      <dt>Monitoring: Collection target</dt><dd>{value(r?.target)}</dd>
      <dt>Monitoring: Latest collected measurement time</dt><dd>{value(r?.measuredAt)}</dd>
      <dt>Monitoring: Collection age</dt><dd>{value(r?.ageUs)}</dd>
      <dt>Monitoring: Collection freshness state</dt><dd>{value(r?.state)}</dd>
    </div>)}</dl>
    <dl><dt>Monitoring backend: Identity</dt><dd>{value(b?.id)}</dd>
      {backendRows.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(b?.[key])}</dd></div>)}
      {(b?.latest?.length ? b.latest : [null]).map((r, i) => <div key={i}>
        <dt>Monitoring backend: Target</dt><dd>{value(r?.target)}</dd>
        <dt>Monitoring backend: Latest measurement time</dt><dd>{value(r?.measurementAt)}</dd>
        <dt>Monitoring backend: Arrival time</dt><dd>{value(r?.arrivedAt)}</dd>
        <dt>Monitoring backend: Measurement age</dt><dd>{value(r?.ageUs)}</dd>
      </div>)}
    </dl>
    <p className="text-xs text-ink-3">Backend received counts accepted sample occurrences, including duplicates; refusals count batches. Latest arrival time belongs to the newest measurement, not necessarily the most recent network arrival. Backend age measures time since that measurement, with no authored backend health threshold. Collector acknowledgements and backend arrivals are independent. Missing saved evidence stays Unknown.</p>
  </section>;
}
