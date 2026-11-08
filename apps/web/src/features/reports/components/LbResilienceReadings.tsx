import type { CircuitBreakerMetrics, LbRetryMetrics } from "@infraforge/contracts/telemetry";

type Reading = readonly [string, number | string | boolean | null | undefined];
const text = (value: Reading[1]) => value == null ? "Unknown" : typeof value === "boolean" ? value ? "Yes" : "No" : value.toLocaleString();
function Rows({rows}: {rows: readonly Reading[]}) {
  return <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="if-num">{text(value)}</dd></div>)}</dl>;
}

export function LbResilienceReadings({id, retry, breaker}: {id: string; retry?: LbRetryMetrics; breaker?: CircuitBreakerMetrics}) {
  const reasons = retry?.suppressedByReason;
  return <section className="mt-4" aria-label={`Retry and circuit measurements for ${id}`}>
    <h3 className="font-semibold">{id}: retry and circuit measurements</h3>
    <p className="mt-2 text-xs text-ink-3">Cumulative totals cover this run segment from time zero to the sampled time, not the final second. Current gauges describe that instant only. Missing historical evidence is Unknown; it is never reconstructed.</p>
    <Rows rows={[
      ["Retry sample time (us)", retry?.sampledAtUs],
      ["LB attempts (cumulative)", retry?.attempts], ["LB retries (cumulative)", retry?.retries],
      ["Retry budget refusals (cumulative)", retry?.retryLimited],
      ["Active retries (current attempts)", retry?.activeRetries], ["Reserved backoffs (current calls)", retry?.retriesWaiting],
      ["Suppressed: attempt limit (cumulative calls)", reasons?.["max-attempts"]],
      ["Suppressed: retry budget (cumulative calls)", reasons?.budget],
      ["Suppressed: deadline (cumulative calls)", reasons?.deadline],
      ["Suppressed: non-retryable (cumulative calls)", reasons?.["non-retryable"]],
      ["Suppressed: ambiguous write (cumulative calls)", reasons?.["ambiguous-write"]],
    ]} />
    <p className="mt-2 text-xs text-ink-3">Attempts include first attempts and retries started by this LB. Active retries exclude backoff reservations. Suppression reasons count calls ended at a retry decision; retry budget refusals are the same budget population, not additional calls.</p>
    <Rows rows={[["Circuit sample time (us)", breaker?.sampledAtUs]]} />
    {!breaker && <p className="mt-2 text-sm">Circuit paths: Unknown</p>}
    {breaker?.paths.map(p => <div key={p.id} className="mt-3">
      <h4 className="font-semibold">{p.source} → {p.target} ({p.id})</h4>
      <Rows rows={[
        ["Circuit state (current)", p.state], ["Circuit generation", p.generation], ["Circuit epoch", p.epoch],
        ["Consecutive failures (current)", p.consecutiveFailures], ["Circuit disposed (current)", p.disposed],
        ["Probe in flight (current)", p.probeInFlight], ["Cooldown end (segment us)", p.openUntil],
        ["Refused while open (cumulative calls)", p.rejected.open], ["Refused while half-open (cumulative calls)", p.rejected["half-open"]],
        ["Refused after disposal (cumulative calls)", p.rejected.disposed],
        ["Probes started (cumulative)", p.probes.started], ["Probes succeeded (cumulative)", p.probes.succeeded],
        ["Probes failed (cumulative)", p.probes.failed], ["Probes cancelled (cumulative)", p.probes.cancelled], ["Probes ignored (cumulative)", p.probes.ignored],
      ]} />
      <p className="mt-2 text-xs text-ink-3">Null cooldown end means no scheduled cooldown. Circuit refusals and probes include path calls and health checks, not just original callers; stale epoch completions do not update this machine. Transitions are cumulative across generations, not a chronological history.</p>
      <h5>Circuit transitions (cumulative edges)</h5>
      <Rows rows={Object.entries(p.transitions)} />
      {!Object.keys(p.transitions).length && <p>No recorded transitions.</p>}
    </div>)}
  </section>;
}
