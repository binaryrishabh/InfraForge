import type { RunComparison } from "@infraforge/contracts/reports";

export function ExperimentCompare({ evidence }: { evidence: RunComparison["experimentEvidence"] }) {
  if (!evidence || evidence.traces.every((t) => t.status === "not-applicable")) return null;
  return <section className="mt-6 border-t border-line pt-5" aria-labelledby="experiment-compare-title">
    <h2 id="experiment-compare-title" className="if-title text-[23px] text-ink">Experiment window evidence</h2>
    <p className="mt-2 max-w-[70ch] text-sm text-ink-2">{evidence.reason}</p>
    <div className="mt-3 grid gap-4 sm:grid-cols-2">{evidence.traces.map((trace, i) => <dl key={i} className="min-w-0 space-y-1 border-l-2 border-line pl-3 text-sm text-ink-2">
      <dt className="font-semibold text-ink">{i === 0 ? "Earlier" : "Later"} trace</dt><dd>{trace.status.replaceAll("-", " ")} · {trace.count} retained samples</dd>
      <dd>{trace.start == null ? "No supported retained window" : `Expected seconds ${trace.start}–${trace.end}`}</dd>
      <dd className="break-words">{trace.highestCpu ? `Highest recorded CPU for ${trace.target} in its retained experiment window: ${trace.highestCpu.value}% at second ${trace.highestCpu.second}.` : "Target CPU peak unavailable."}</dd>
    </dl>)}</div>
    <p className="mt-2 text-xs text-ink-3">Gaps and complete per-second values appear in each run's debrief. No overlaid or interpolated curves are produced.</p>
  </section>;
}
