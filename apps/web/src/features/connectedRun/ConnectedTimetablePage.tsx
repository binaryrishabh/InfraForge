import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { internalReport } from "@/api/internalModel2.api";
import { useRequest } from "@/api/useRequest";
import { Button } from "@/ui/Button";
import { cx } from "@/ui/cx";
import { Loading, Notice, Page, PageHeader } from "@/ui/Page";
import { Timetable } from "@/features/timetable/Timetable";
import { StationMap } from "@/features/timetable/StationMap";
import { Legend } from "@/features/timetable/Legend";
import { statesAt } from "@/features/timetable/stationStates";
import { formatTime, type Train } from "@/features/timetable/model";
import { fromCausalJournal, journalOf, pathEdges, type CausalEvent } from "@/features/timetable/fromCausal";

// The readable tail of a recorded root identity, such as "arrival-3".
const requestName = (id: string) => { try { const parts = JSON.parse(id); return String(parts.at(-1)); } catch { return id; } };
const us = (t: number) => formatTime(t, "us");

/* INTERNAL: one connected Model 2 run, request by request. Everything drawn here comes from
the run's recorded causal journal; when a run has no journal, nothing is drawn in its place. */
export function ConnectedTimetablePage() {
  const { runId = "" } = useParams();
  const load = useCallback(() => internalReport(runId), [runId]);
  const { data: report, loading, error, retry } = useRequest(load, "This internal run could not be loaded. It may not exist, or this account may not have internal access.");
  const journal = report ? journalOf(report) : null;
  const model = useMemo(() => (journal && report ? fromCausalJournal(journal, report.throughUs) : null), [journal, report]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const header = <PageHeader eyebrow={<>Model 2 · internal · <Link to="/internal/model2" className="text-accent hover:underline">workspace</Link></>}
    title="Request by request." lede="Each request is drawn as it was recorded: when it reached each part of the system, what it waited for, and how it ended. Time runs left to right." />;
  if (loading) return <Page width="wide">{header}<Loading label="Loading the recorded journal…" /></Page>;
  if (error || !report) return <Page width="wide">{header}<Notice tone="fail" role="alert">{error}</Notice><Button className="mt-3" size="sm" onClick={retry}>Try again</Button></Page>;
  if (!model || !journal) return <Page width="wide">{header}<Notice title="No causal journal was recorded for this run">Only connected runs record a causal journal. This run's report is in the internal workspace.</Notice></Page>;

  const t = cursor ?? model.marks[0]?.t ?? 0;
  const states = { ...statesAt(model, t), $caller: { reading: "sends the requests" } };
  const nodes = model.stations.map((s) => ({ id: s.id, type: s.id === "$caller" ? "Caller" : s.type, label: s.label }));
  const edges = pathEdges(model);
  const atCursor = journal.events.filter((e) => e.atUs === t);
  const train = model.trains.find((tr) => tr.id === focus) ?? null;
  return (
    <Page width="wide">
      {header}
      <p className="mt-2 text-sm text-ink-3">Run <span className="if-num text-ink-2">{report.id}</span> · {report.status} · horizon {us(report.throughUs)} · {model.evidence.note}
        {!model.evidence.complete && <span className="font-semibold text-warn"> The journal is incomplete; missing events are Unknown.</span>}</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <figure className="if-paper-grid border border-line bg-canvas p-3">
          <StationMap nodes={nodes} edges={edges} states={states} label={`Recorded state at ${us(t)}`} className="max-h-[320px]" />
          <figcaption className="px-1 pt-2 text-xs text-ink-3">Rails are the paths requests were recorded taking. State flags are the recorded process and load-balancer intervals at {us(t)}.</figcaption>
        </figure>
        <aside aria-label={`Recorded at ${us(t)}`} className="border border-line bg-surface p-4">
          <p className="if-num text-[26px] font-semibold leading-none text-ink">{us(t)}</p>
          <h2 className="mt-4 text-xs font-semibold text-ink-3">Recorded at this moment</h2>
          {atCursor.length ? <ul role="status" className="mt-2 space-y-1.5 text-sm">{atCursor.slice(0, 12).map((e, i) => <EventLine key={i} event={e} />)}</ul>
            : <p role="status" className="mt-2 text-sm text-ink-3">No event was recorded at exactly this moment. Use the arrow keys on the timetable to step between recorded events.</p>}
          {train && <TrainStops train={train} onClear={() => setFocus(null)} onPick={setCursor} />}
        </aside>
      </div>

      <section className="mt-6 border border-line bg-surface px-4 pt-4 pb-3" aria-label="Timetable">
        <Timetable model={model} cursor={t} onCursor={setCursor} focus={focus} minHeight={360}
          label="Connected run timetable. Arrow keys step between recorded events." />
        <Legend className="mt-3" health={false} cpu={false} unknown={false} trains bands />
      </section>

      <section className="mt-8" aria-labelledby="requests-title">
        <h2 id="requests-title" className="if-title text-[22px]">Requests</h2>
        <p className="mt-1 text-sm text-ink-3">Choose one to follow it through the timetable.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-ink-3"><tr>{["Request", "Operation", "Offered", "Path", "Outcome", "Response"].map((h) => <th key={h} className="border-b border-line py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{model.trains.map((tr) => {
              const response = tr.endAt !== null ? tr.endAt - tr.stops[0]!.t : null;
              return (
                <tr key={tr.id} className={cx("border-b border-line", focus === tr.id && "bg-raised")}>
                  <td className="py-1.5 pr-3"><button type="button" aria-pressed={focus === tr.id} onClick={() => { setFocus(focus === tr.id ? null : tr.id); setCursor(tr.stops[0]!.t); }}
                    className="if-num font-semibold text-accent hover:underline">{requestName(tr.id)}</button></td>
                  <td className={cx("py-1.5 pr-3", tr.op === "write" ? "text-write" : "text-read")}>{tr.op}</td>
                  <td className="if-num py-1.5 pr-3 text-ink-2">{us(tr.stops[0]!.t)}</td>
                  <td className="py-1.5 pr-3 text-ink-2">{[...new Set(tr.stops.map((s) => s.station === "$caller" ? "caller" : s.station))].join(" → ")}</td>
                  <td className={cx("py-1.5 pr-3", tr.outcome === "completed" ? "text-ink" : tr.outcome === "in-flight" ? "text-ink-3" : "font-semibold text-fail")}>{tr.outcome === "in-flight" ? "Unknown (no outcome by the horizon)" : tr.outcome}</td>
                  <td className="if-num py-1.5 text-ink-2">{response !== null ? us(response) : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>
    </Page>
  );
}

function EventLine({ event }: { event: CausalEvent }) {
  const where = event.resource === "$caller" ? "caller" : event.resource;
  const who = event.work ? requestName(event.work.rootId) : typeof event.detail?.id === "string" ? requestName(event.detail.id) : null;
  return <li><span className="font-semibold text-ink">{event.kind.replace(/-/g, " ")}</span><span className="text-ink-3"> · {where}{who ? ` · ${who}` : ""}</span></li>;
}

function TrainStops({ train, onClear, onPick }: { train: Train; onClear: () => void; onPick: (t: number) => void }) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{requestName(train.id)} <span className="font-normal text-ink-3">· {train.op}</span></h2>
        <button type="button" onClick={onClear} className="text-xs font-medium text-accent hover:underline">Show every request</button>
      </div>
      <ol className="mt-2 max-h-[260px] space-y-1 overflow-y-auto text-xs">{train.stops.map((s, i) => (
        <li key={i}><button type="button" onClick={() => onPick(s.t)} className="if-num w-full text-left text-ink-2 hover:text-ink">{us(s.t)} · {s.station === "$caller" ? "caller" : s.station} · {s.kind.replace(/-/g, " ")}</button></li>
      ))}</ol>
    </div>
  );
}
