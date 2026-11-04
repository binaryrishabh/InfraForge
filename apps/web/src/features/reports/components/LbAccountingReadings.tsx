import type { LbAccountingMetrics } from "@infraforge/contracts/telemetry";

export function LbAccountingReadings({ metrics }: { metrics: LbAccountingMetrics }) {
  const rows = [
    ["Rejected at load balancer (calls)", metrics.rejectedAtLb],
    ["Queued at load balancer (calls)", metrics.queuedAtLb],
    ["Admitted by backend (attempts)", metrics.acceptedByBackend],
    ["Queued at VM (attempts)", metrics.queuedAtVm],
    ["Refused by VM (attempts)", metrics.rejectedByVm],
    ["Downstream timeouts (attempts)", metrics.timedOutDownstream],
  ] as const;
  return <div className="mt-4">
    <p className="text-xs text-ink-3">Cumulative since this run segment began. Queue counts are admissions that waited, not current depth. Counters overlap; retries count as separate backend attempts.</p>
    <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="if-num">{value.toLocaleString()}</dd></div>)}</dl>
  </div>;
}
