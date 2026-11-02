import type { ObjectiveMetrics } from "@infraforge/contracts/telemetry";

const statuses = { met: "Met", missed: "Missed", undetermined: "Not decided yet", unknown: "Unknown" } as const;
const fraction = (value: number | null, numerator: number, denominator: number) => value === null ? "Unknown" :
  `${numerator}/${denominator} (${(value * 100).toFixed(4).replace(/\.?0+$/, "")}%)`;

export function ObjectiveReadings({ objective: o }: { objective: ObjectiveMetrics }) {
  const rows = [["Original requests", o.offered], ["In time", o.good], ["Late", o.late], ["Failed", o.failed],
    ["Deadline exceeded", o.deadlineExceeded], ["Abandoned", o.abandoned],
    ["Past threshold but unresolved", o.unresolvedPastThreshold], ["Still pending", o.pending]] as const;
  return <div aria-label="Service objective" className="mt-3 min-w-0 border-t border-line pt-2">
    <p className="font-semibold">Service objective: {statuses[o.status]}</p>
    <p className="text-xs text-ink-2">{o.objective.targetSuccessPercent}% within {o.objective.maxResponseMs} ms · From run start through {o.throughUs / 1000000} s (horizon {o.horizonUs / 1000000} s).</p>
    <dl className="my-2 grid min-w-0 gap-2 sm:grid-cols-3">{([
      ["Measured in time", fraction(o.measuredFraction, o.good, o.offered)],
      ["Worst case", fraction(o.worstCaseFraction, o.good, o.offered)],
      ["Best case", fraction(o.bestCaseFraction, o.good + o.pending, o.offered)],
    ] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-3">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{rows.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-3">{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="mt-2 text-xs text-ink-3">Original requests include every outcome; retries add attempts. Requests still waiting can still change the result. An educational objective for this run, not a provider SLA.</p>
  </div>;
}
