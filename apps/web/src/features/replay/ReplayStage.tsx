import { useCallback, useMemo, useState } from "react";
import type { RunReport } from "@infraforge/contracts/reports";
import { getChallenge } from "@/api/challenges.api";
import { useRequest } from "@/api/useRequest";
import { Timetable } from "@/features/timetable/Timetable";
import { StationMap } from "@/features/timetable/StationMap";
import { fromExperimentTrace, faultLabel } from "@/features/timetable/fromTrace";
import { statesAt, statesFromCheckpoint } from "@/features/timetable/stationStates";
import { formatTime } from "@/features/timetable/model";
import { Legend } from "@/features/timetable/Legend";
import { useRunTopology } from "./useRunTopology";
import { MomentReadout } from "./MomentReadout";
import { Verdict } from "./Verdict";

/* The top of a run's page: the verdict, then the recorded run you can move through.
A resilience attempt keeps a per-second window, so the map and timetable can be scrubbed.
Other runs keep one final snapshot, so the map shows that one moment and says so. */
export function ReplayStage({ report }: { report: RunReport }) {
  const topology = useRunTopology(report);
  const challenge = report.challenge;
  const loadBrief = useCallback(() => challenge ? getChallenge(challenge.challengeId, challenge.version || undefined) : Promise.resolve(null), [challenge]);
  const brief = useRequest(loadBrief).data;
  const experiment = challenge?.experiment ?? null, trace = report.experimentTrace;
  const model = useMemo(() => experiment && trace ? fromExperimentTrace({
    trace, experiment, predictions: challenge?.predictions, questions: brief?.predictions,
    stations: topology.nodes.map((n) => ({ id: n.id, label: n.label, type: n.type })),
  }) : null, [experiment, trace, challenge, brief, topology.nodes]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const t = cursor ?? model?.end ?? 0;
  const snapshot = report.terminal ?? report.checkpoint;

  return (
    <section aria-label="Recorded run" className="space-y-6">
      {challenge && <Verdict evaluation={challenge} />}
      {model ? <>
        <div className="grid gap-px border border-line bg-line lg:grid-cols-[minmax(0,1fr)_340px]">
          <figure className="if-paper-grid relative min-w-0 overflow-hidden bg-canvas p-3">
            <figcaption className="absolute left-4 top-3 text-xs text-ink-3">The recorded architecture at <span className="if-num text-ink">{formatTime(t, model.unit)}</span></figcaption>
            <StationMap nodes={topology.nodes} edges={topology.edges} states={statesAt(model, t)} label={`Architecture at ${formatTime(t, model.unit)}`}
              marked={experiment!.targetResourceId} markLabel={faultLabel(experiment!.fault)} selected={selected} onSelect={(id) => setSelected((s) => s === id ? null : id)}
              className="mx-auto mt-6 max-h-[420px]" />
            {!topology.connectionsKnown && !topology.loading && <p className="mt-2 text-xs text-ink-3">This older run kept its resources but not its connections, so no rails are drawn.</p>}
          </figure>
          <div className="bg-bg p-5"><MomentReadout model={model} t={t} /></div>
        </div>
        <div className="border border-line bg-bg px-4 pb-3 pt-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-ink">Timetable</h2>
            <p className="text-xs text-ink-3">Drag across the timetable or use the arrow keys. {model.evidence.note}</p>
          </div>
          <Timetable model={model} cursor={t} onCursor={setCursor} focus={selected} label="Recorded run timetable. Use arrow keys to move between retained seconds." />
          <Legend className="mt-3" predictions={model.predictions.length > 0} />
        </div>
        {report.guidedReview && report.guidedReview.cues.some((c) => c.simulatedSecond != null) && (
          <div className="border border-line bg-bg p-5">
            <h2 className="text-[15px] font-semibold text-ink">Moments the record points to</h2>
            <ol className="mt-3 grid gap-3 md:grid-cols-2">
              {report.guidedReview.cues.filter((c) => c.simulatedSecond != null && c.kind !== "unknown").map((c) => (
                <li key={c.id} className="border-l-2 border-line-strong pl-3">
                  <button className="if-num text-sm font-semibold text-accent hover:underline" onClick={() => { setCursor(c.simulatedSecond!); if (c.resourceId) setSelected(c.resourceId); }}>
                    {formatTime(c.simulatedSecond!, "s")}{c.resourceId ? ` · ${c.resourceId}` : ""}
                  </button>
                  <p className="mt-0.5 text-sm font-medium text-ink">{c.title}</p>
                  <p className="mt-0.5 text-sm text-ink-2">{c.statement}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </> : topology.nodes.length > 0 && (
        <figure className="if-paper-grid relative border border-line bg-canvas p-3">
          <figcaption className="absolute left-4 top-3 text-xs text-ink-3">{snapshot ? <>The last recorded snapshot{snapshot.simulatedSeconds != null ? <> at <span className="if-num text-ink">{snapshot.simulatedSeconds}s</span></> : null}. Only this moment is retained for this run.</> : "No snapshot was retained; the map shows the architecture only."}</figcaption>
          <StationMap nodes={topology.nodes} edges={topology.edges} states={snapshot ? statesFromCheckpoint(snapshot) : undefined} label="Architecture at the last recorded snapshot" className="mx-auto mt-6 max-h-[380px]" />
        </figure>
      )}
    </section>
  );
}
