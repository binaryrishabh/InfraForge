import { useEffect, useRef, useState } from "react";
import type { InternalReport as Report, Json, ReplayResult } from "@infraforge/contracts/internal-model2";
import * as api from "@/api/internalModel2.api";
import { Button } from "@/ui/Button";
import { Notice, Loading } from "@/ui/Page";
function Value({ value }: { value: Json }) {
  if (value === null) return <span>Unavailable</span>;
  if (Array.isArray(value)) return <ul className="space-y-2">{value.map((v, i) => <li key={i} className="border-l border-line pl-3"><Value value={v} /></li>)}</ul>;
  if (typeof value === "object") return <dl className="space-y-1">{Object.entries(value).map(([key, child]) => <div key={key} className="flex flex-wrap gap-x-3"><dt className="font-medium">{key}</dt><dd className="min-w-0 break-words"><Value value={child} /></dd></div>)}</dl>;
  return <span>{String(value)}</span>;
}
export function InternalReport({ id, blocked }: { id: string; blocked: () => void }) {
  const [report, setReport] = useState<Report | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [replay, setReplay] = useState<ReplayResult | null>(null), [version, setVersion] = useState(0), [stopped, setStopped] = useState(false);
  const action = useRef(false), control = useRef(new AbortController()), region = useRef<HTMLElement>(null);
  useEffect(() => { region.current?.focus(); }, [id]);
  useEffect(() => {
    const controller = new AbortController(); control.current = controller; let timer: ReturnType<typeof setTimeout> | undefined, count = 0;
    const read = async () => {
      try { const value = await api.internalReport(id, controller.signal); if (controller.signal.aborted) return; setReport(value); setError(""); if (!value.replay.compatible) setReplay(null);
        if (["queued", "running"].includes(value.status) && ++count < 60) timer = setTimeout(() => { void read(); }, 2000);
        else setStopped(["queued", "running"].includes(value.status));
      } catch (e) { if (!controller.signal.aborted) { const detail = api.internalError(e); setError(detail.message); if (detail.denied) { setReport(null); blocked(); } } }
    };
    void read(); return () => { controller.abort(); clearTimeout(timer); };
  }, [id, version, blocked]);
  const act = async (kind: "cancel" | "replay") => {
    if (action.current) return; action.current = true; setBusy(true);
    const signal = control.current.signal;
    try { if (kind === "cancel") { await api.cancelInternal(id, signal); if (!signal.aborted) setVersion((v) => v + 1); } else { const value = await api.replayInternal(id, signal); if (!signal.aborted) setReplay(value); } }
    catch (e) { if (!signal.aborted) { const detail = api.internalError(e); setError(detail.message); if (detail.denied) { setReport(null); blocked(); } } }
    finally { action.current = false; if (!signal.aborted) setBusy(false); }
  };
  return <section ref={region} tabIndex={-1} aria-label="Durable Model-2 report" className="mt-10 space-y-5 border-t border-line pt-6 outline-none">
    <h2 className="text-2xl font-semibold">Last durable result</h2><p className="break-all text-sm text-ink-3">Run {id}</p>
    {error && <Notice tone="fail" role="alert">{error}</Notice>}
    {!report && !error && <Loading label="Reading retained evidence…" />}
    <Button size="sm" disabled={busy} onClick={() => { setStopped(false); setVersion((v) => v + 1); }}>Refresh durable report</Button>
    {stopped && <p role="status">Automatic refresh stopped after 60 reads. Refresh manually to read the latest committed state.</p>}
    {report && <>
      <p role="status" className="font-semibold">Status: {report.status} · capture {report.sequence} · through {report.throughUs} us</p>
      <p className="text-sm">{report.reason || "Lifecycle status is the last committed state, not a worker liveness signal."} {report.status !== "completed" && "Retained prefix only; missing work is not zero. Crashed executions are not resumed."}</p>
      {report.problems.length > 0 && <Notice tone="fail">{report.problems.join(" ")}</Notice>}
      <div className="flex flex-wrap gap-3"><Button loading={busy} disabled={!report.replay.compatible} onClick={() => { void act("replay"); }}>Verify deterministic replay</Button>{["queued", "running"].includes(report.status) && <Button disabled={busy} onClick={() => { void act("cancel"); }}>Cancel this run</Button>}</div>
      <p className="text-sm">{report.replay.reason} Cancellation stops at a capture boundary and retains its committed prefix.</p>
      {replay && <Notice><span role="status">Replay: {replay.kind}. {replay.reason} {replay.complete === false ? "Matches a prefix only, not a complete execution." : replay.complete ? "Complete recorded capture matches." : ""} {replay.mutation}</span></Notice>}
      <div className="grid gap-6 lg:grid-cols-2">{[["Observed modeled facts", report.observed], ["Interpreted", report.interpreted]] .map(([title, rows]) => <section key={String(title)} className="rounded-md border border-line p-4"><h3 className="mb-3 font-semibold">{String(title)}</h3><Value value={rows as Json} /></section>)}</div>
      <section className="rounded-md border border-line p-4"><h3 className="mb-3 font-semibold">Unknown and uncertainties</h3><ul className="list-disc space-y-2 pl-5 text-sm">{report.unknown.map((s) => <li key={s}>{s}</li>)}</ul></section>
      {[["Service activity, commands, object state and faults", report.state], ["Usage evidence", report.usage], ["Retained checkpoint history", report.checkpoints]].map(([title, value]) => <details key={String(title)} className="rounded-md border border-line p-4"><summary className="cursor-pointer font-semibold">{String(title)}</summary><div className="mt-4 text-sm"><Value value={value as Json} /></div></details>)}
      <details><summary className="cursor-pointer text-sm underline">Input and execution identity</summary><p className="break-all text-xs">Input {report.inputHash}<br />Source {report.source ?? "Unknown"}</p></details>
    </>}
  </section>;
}
