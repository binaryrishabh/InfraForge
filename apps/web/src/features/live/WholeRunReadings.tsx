import type { WholeRunMetrics } from "@infraforge/contracts/telemetry";

export function WholeRunReadings({ wholeRun: w, recorded }: { wholeRun: WholeRunMetrics; recorded: boolean }) {
  const rows = [
    ...(["p50", "p95", "p99"] as const).map(p => [p, w.percentiles[p] === null ? "Unknown" : `${w.percentiles[p].highMs} ms (within 3%)`]),
    ["Completed", w.completed], ["Failed", w.failed], ["Deadline exceeded", w.deadlineExceeded], ["Abandoned", w.abandoned], ["In-flight", w.inFlight],
  ];
  return <div aria-label="Whole-run response times" className="mt-3 border-t border-line pt-2">
    <p className="mb-2 font-semibold">{recorded ? `Whole run (through second ${w.throughSecond})` : "Whole run so far"}</p>
    <dl className="grid grid-cols-3 gap-2">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-ink-3">{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="mt-2 text-xs text-ink-3">Percentiles of every completed request since the run started. Each value is the upper end of a bucket about 3% wide; the true value is at or below it.</p>
  </div>;
}
