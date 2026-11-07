import type { DurationEvidence } from "@infraforge/contracts/reports";

const value = (n: number | boolean | null | undefined) => n == null ? "Unknown" : String(n);
const phases = [["queued", "Duration: Query queue"], ["lock", "Duration: Query lock"], ["cpu", "Duration: Query CPU phase"],
  ["io", "Duration: Query IO phase"], ["wait", "Duration: Query blocking phase"], ["commit", "Duration: Query commit phase"]] as const;
const pathPhases = [["connectionWaitUs", "Duration: Acquired pool wait"], ["requestTransportUs", "Duration: Delivered request transport"],
  ["remoteServiceUs", "Duration: Returned remote service"], ["responseTransportUs", "Duration: Delivered response transport"]] as const;

export function DurationReadings({evidence: e}: {evidence?: DurationEvidence}) {
  return <section aria-label="Owned duration measurements" className="mt-4 text-sm">
    <h3 className="font-semibold">Owned duration measurements</h3>
    <p className="text-xs text-ink-3">Cumulative from run start through the recorded boundary, in simulated microseconds (us). CPU consumption is core-us; slot hold sums occupied slot time across work. These are different populations and must not be added together or treated as caller latency.</p>
    <dl><dt>Duration: Through time</dt><dd>{value(e?.throughUs)}</dd>
      <dt>Complete timestamp</dt><dd>{value(e?.timestampComplete)}</dd>
      <dt>Omitted duration owners</dt><dd>{value(e?.resourcesOmitted)}</dd>
      <dt>Omitted duration paths</dt><dd>{value(e?.pathsOmitted)}</dd></dl>
    {(e?.resources.length ? e.resources : [null]).map((r, i) => <div key={r?.id ?? i}>
      <h4>{r ? `${r.id} (${r.kind})` : "Duration owner: Unknown"}</h4>
      <dl><dt>Duration: Slot hold</dt><dd>{value(r?.busySlotUs)}</dd>
        <dt>Duration: CPU consumption</dt><dd>{value(r?.consumedCoreUs)}</dd>
        <dt>Cancelled resource work (count)</dt><dd>{value(r?.cancelled)}</dd>
        {phases.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(r?.phasesUs?.[key])}</dd></div>)}</dl>
    </div>)}
    <p className="text-xs text-ink-3">Query phases exist only for the finite-IO profile. CPU phase includes scheduler contention; IO includes coalesced waiting; commit includes its modeled acknowledgement. Active query phases sum to the measured slot hold; query queue time is outside that hold. Durations include cancelled work and live partial phases. Ordinary app and worker phase durations are Unknown. Worker slot hold excludes buffered and acknowledgement-wait work.</p>
    {(e?.paths.length ? e.paths : [null]).map((p, i) => <div key={p?.id ?? i}>
      <h4>{p ? `${p.id}: ${p.source} → ${p.target}` : "Duration path: Unknown"}</h4>
      <dl>{pathPhases.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(p?.reachedPhaseUs[key])}</dd></div>)}
        <dt>Duration: Unfinished acquisition</dt><dd>{value(p?.unfinishedAcquisitionUs)}</dd>
        <dt>Path offered / completed / failed / cancelled / live (counts)</dt><dd>{p ? [p.offered, p.completed, p.failed, p.cancelled, p.live].join(" / ") : "Unknown"}</dd>
        <dt>Pending acquisitions (count)</dt><dd>{value(p?.pendingAcquisitions)}</dd></dl>
    </div>)}
    <p className="text-xs text-ink-3">Each path total includes only phases whose end was reached, even if a later phase failed or cancelled. Acquired pool wait includes connection establishment. Failed, cancelled and pending acquisitions have no measured wait duration; unfinished acquisition is Unknown. No per-phase population counts or continuous incident history were recorded. A zero reached-phase total does not establish that nobody waited. Missing and omitted evidence is Unknown.</p>
  </section>;
}
