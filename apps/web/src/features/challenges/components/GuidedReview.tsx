import type { RunReport } from "@infraforge/contracts/reports";
import { BeginImprovement } from "./BeginImprovement";
import { EVIDENCE_LABEL } from "../challengeLabels";
import { focusMeasurement } from "@/features/reports/resourceFocus";

// A small reading scaffold over the canonical record. Facts are selected by the
// server; the browser neither evaluates requirements nor manufactures advice.
export function GuidedReview({ report, withImprovement = true }: { report: RunReport; withImprovement?: boolean }) {
  const review = report.guidedReview, e = report.challenge;
  if (!review || !e) return null;
  const expectations = [...e.predictions].sort((a, b) => Number(b.outcome === "different") - Number(a.outcome === "different")).slice(0, 2);
  return <section id="guided-review" tabIndex={-1} aria-labelledby="guided-title" className="mt-7 scroll-mt-32 rounded-lg border border-line-strong bg-surface p-4 outline-none sm:p-6">
    <p className="if-eyebrow">Read → question → test</p>
    <h2 id="guided-title" className="if-title mt-1 text-[26px]">Read this attempt</h2>
    <p className="mt-1 text-sm text-ink-2">Start with a few retained facts. The full evidence record follows below.</p>
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-[15px] font-semibold">1. What did you expect?</h3>
      {expectations.length ? <ul className="mt-2 space-y-2 text-sm">{expectations.map((p) => <li key={p.id}><p className="text-ink-2">{p.prompt}</p><p>You predicted <strong>{p.predicted}</strong>. Recorded: <strong>{p.actual ?? "unknown"}</strong>.</p></li>)}</ul> : <p className="mt-2 text-sm">No readable prediction was retained.</p>}
      {e.reasoning && <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-sm italic text-ink-2">{e.reasoning}</blockquote>}
    </div>
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-[15px] font-semibold">2. Follow the recorded facts</h3>
      <ol className="mt-2 divide-y divide-line">{review.cues.filter((c) => c.kind !== "unknown").map((c) => <li key={c.id} className="py-3 text-sm">
        <h4 className="font-semibold text-ink">{c.title}</h4><p className="mt-1 text-ink-2">{c.statement}</p>
        <p className="mt-1 break-words text-xs text-ink-3">Evidence: {c.sources.map((s) => EVIDENCE_LABEL[s] ?? s).join(" · ")}</p>
        <details className="mt-1 text-xs text-ink-3"><summary className="cursor-pointer">How far does this fact go?</summary><p className="mt-1">{c.limit}</p></details>
        {c.resourceId && <button className="mt-2 font-medium text-accent underline" onClick={() => focusMeasurement(c.resourceId!)}>Inspect {c.resourceId} in the recorded snapshot</button>}
      </li>)}</ol>
      {review.cues.every((c) => c.kind === "unknown") && <p className="mt-2 text-sm">The evidence does not support selecting a measured result.</p>}
    </div>
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-[15px] font-semibold">3. What remains unknown?</h3>
      {review.cues.filter((c) => c.kind === "unknown").map((c) => <div key={c.id} className="mt-2 text-sm text-ink-2"><p>{c.statement}</p><p className="mt-1 text-xs text-ink-3">{c.limit}</p></div>)}
    </div>
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-[15px] font-semibold">4. What one thing will you test?</h3>
      <p className="mt-2 mb-3 text-sm text-ink-2">Keep other conditions fixed, make a deliberate change, predict again, then compare. One change makes this pair easier to read; it does not rule out interactions or prove a universal effect.</p>
      <details className="mb-3 text-xs text-ink-3"><summary className="cursor-pointer">Reading CPU</summary><p className="mt-1">CPU is the share of a modeled resource's processing capacity being used at the recorded second. A high value alone does not identify the cause.</p></details>
      {withImprovement && <BeginImprovement report={report} />}
    </div>
  </section>;
}
