import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { RunComparison } from "@infraforge/contracts/reports";
import { formatDate } from "@/lib/format";
import { Button } from "@/ui/Button";
import { HealthMark } from "@/ui/HealthMark";
import { Loading, Notice } from "@/ui/Page";
import { CompareMetrics } from "./CompareMetrics";
import { StartingInputs } from "./StartingInputs";
import { ActionTimeline } from "./ActionTimeline";
import { ReportSection, Statement } from "./ReportSection";
import { runKind, runStatus } from "../runKind";
import { STAGE_LABEL, STAGE_STATUS_LABEL } from "../labels";
import { DesignChangeSummary } from "@/features/challenges/components/DesignChangeSummary";

const HEADLINE: Record<RunComparison["headline"], { title: string; body: string }> = {
  "descriptive-only": { title: "Side by side only", body: "These runs can be read next to each other, but differences in their inputs or evidence mean they are not a controlled pair." },
  "starting-inputs-only": { title: "Starting inputs compared", body: "The starting inputs are compared below. Conduct, duration or final evidence differ or are missing, so final-state differences cannot be attributed to the starting change." },
  "matched-pair": { title: "Matched pair", body: "Both runs have exact final captures, the same simulated duration and the same recorded conduct. Differences may relate to the starting change listed below; one pair establishes no general effect." },
  "determinism-match": { title: "Same setup, same result", body: "The same starting inputs and conduct produced the same normalized final state under simulation model 1." },
  "determinism-mismatch": { title: "Same setup, different result", body: "Under simulation model 1 these runs should match, but they do not. This may indicate an InfraForge determinism defect." },
};
const EVIDENCE: Record<RunComparison["evidence"]["code"], string> = {
  "both-exact": "Both runs have exact terminal captures.",
  "exact-and-checkpoint": "One run has an exact terminal capture; the other only a diagnostic checkpoint.",
  "checkpoints-only": "Only diagnostic checkpoints exist; they may predate the stop.",
  missing: "Final evidence is missing for at least one run.",
};
const LINEAGE: Record<RunComparison["lineage"], string> = { "source-and-improvement": "One attempt records the other as its learning source.", "source-and-rerun": "One run is a rerun of the other.", siblings: "Both are reruns of the same source.", unrelated: "No recorded lineage between them." };

export function CompareContent({ loading, error, data, retry }: { loading: boolean; error: string | null; data: RunComparison | null; retry: () => void }) {
  if (loading) return <Loading label="Loading comparison…" />;
  if (error || !data) return (
    <div role="alert" className="mt-10 flex flex-col items-start gap-3"><Notice tone="fail">{error ?? "Comparison unavailable."}</Notice>
      <Button size="sm" onClick={retry}>Try again</Button><Link className="text-sm font-medium text-accent hover:underline" to="/runs">Back to runs</Link></div>
  );
  return <CompareView comparison={data} />;
}

export function CompareView({ comparison: c }: { comparison: RunComparison }) {
  const verdict = HEADLINE[c.headline];
  let n = 0;
  const k = () => ++n;
  return (
    <article className="min-w-0 break-words pt-6">
      <Link to="/runs" className="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink"><ArrowLeft size={14} aria-hidden="true" /> Runs</Link>
      <h1 className="if-display mt-4 text-[34px] sm:text-[40px]">Compare two runs</h1>
      <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
        {c.runs.map((r, i) => (
          <div key={r.id} className="min-w-0 bg-raised p-4">
            <p className="if-eyebrow">{i === 0 ? "Earlier" : "Later"} · {runKind(r).label}</p>
            <Link className="mt-1 block truncate text-[17px] font-semibold text-ink underline-offset-4 hover:underline" to={`/runs/${r.id}`}>{r.infrastructureName}</Link>
            <p className="text-xs text-ink-3">{runStatus(r.status).label} · {formatDate(r.createdAt)}</p>
            <p className="if-num mt-0.5 break-all text-[11px] text-ink-3">{r.id}</p>
          </div>
        ))}
      </div>

      <section aria-labelledby="verdict-title" className="mt-6 border-l-[3px] border-ink bg-surface px-5 py-4">
        <p className="if-eyebrow">How comparable</p>
        <h2 id="verdict-title" className="if-title mt-1 text-[24px] text-ink">{verdict.title}</h2>
        <p className="mt-1 max-w-[70ch] text-[15px] text-ink-2">{verdict.body}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-ink-3">Final evidence</dt><dd className="text-ink">{EVIDENCE[c.evidence.code]}</dd></div>
          <div><dt className="text-xs text-ink-3">Conduct (actions)</dt><dd className="text-ink">{c.conduct.code === "same" ? "Same recorded actions." : c.conduct.code === "different" ? "Different recorded actions." : "Cannot be established."}</dd></div>
          <div><dt className="text-xs text-ink-3">Lineage</dt><dd className="text-ink">{LINEAGE[c.lineage]}</dd></div>
          {c.challengeConditions && <div className="sm:col-span-3"><dt className="text-xs text-ink-3">Challenge conditions</dt><dd className="text-ink">{c.challengeConditions === "same"
            ? "Same challenge version, rules, workload, seed, evaluation second and scheduled fault."
            : "Different challenge versions or recorded conditions; their results were judged by different rules."}</dd></div>}
        </dl>
        <p className="mt-2 text-xs text-ink-3">{c.conduct.speedNote}</p>
        {!c.available && <p role="status" className="mt-2 text-sm text-warn">{c.unavailableReason}</p>}
      </section>

      <ReportSection number={k()} title="What stayed the same, what changed"><StartingInputs starting={c.starting} /></ReportSection>
      {c.designChangeReview && <section aria-labelledby="learning-pair" className="mt-6 rounded-md border border-line p-4">
        <h2 id="learning-pair" className="font-semibold">{c.designChangeReview.classification === "one-change" ? "One simulation-relevant design change" : c.designChangeReview.classification === "no-change" ? "No simulation-relevant design change" : c.designChangeReview.classification === "several-changes" ? "Several design facts changed" : "Design change count unavailable"}</h2>
        <DesignChangeSummary review={c.designChangeReview} />
        {c.runs.map((r) => r.learning && <p key={r.id} className="mt-2 text-sm text-ink-2">Your hypothesis: {r.learning.hypothesis}</p>)}
        <p className="mt-2 text-sm text-ink-3">{c.designChangeReview.count === 1 && c.headline === "matched-pair" && c.starting.alignment.code === "aligned" ? "With the same challenge conditions, matched exact evidence and one design fact changed, this pair is easier to interpret. " : "Read the comparability and evidence limits before relating these results to the design edits. "}One pair still cannot establish a general effect; model-1 ordering and random-draw alignment limits still apply.</p>
      </section>}
      <ExperimentCompare evidence={c.experimentEvidence} />
      <ReportSection number={k()} title="Observed — recorded facts"><ul className="flex flex-col gap-3">{c.observed.map((f) => <Statement key={f.id} message={f.message} sources={f.sources} />)}</ul></ReportSection>
      {c.interpreted.length > 0 && <ReportSection number={k()} title="Interpreted — what the evidence supports"><ul className="flex flex-col gap-3">{c.interpreted.map((f) => <Statement key={f.id} message={f.message} sources={f.sources} verb="Derived from" />)}</ul></ReportSection>}
      <ReportSection number={k()} title="Final-state differences">
        <CompareMetrics metrics={c.outcomes} caption="Recorded stop state" />
        {c.resources.map((r) => (
          <div key={r.id} className="mt-6">
            <h3 className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] font-semibold text-ink">{r.id}
              <span className="flex items-center gap-2 text-xs font-normal text-ink-3">earlier <HealthMark size="sm" value={r.earlierHealth} /> later <HealthMark size="sm" value={r.laterHealth} /></span></h3>
            <div className="mt-2"><CompareMetrics metrics={r.metrics} caption={`Retained resource measurements: ${r.id}`} /></div>
          </div>
        ))}
      </ReportSection>
      <ReportSection number={k()} title="Cost">
        <p className="mb-3 text-ink-3">Educational model output, not a cloud bill. Hourly burn, accumulated cost and the design's monthly estimate are separate measures.</p>
        <CompareMetrics metrics={c.costs} caption="Simulated costs and gate estimate" />
      </ReportSection>
      <ReportSection number={k()} title="What this pair cannot show">
        <p>A single pair cannot establish statistical significance, production reliability, real cloud behaviour or general superiority across seeds. Even the same seed is not a perfectly controlled comparison.</p>
        <ul className="mt-3 flex flex-col gap-3">{c.unknown.map((f) => <Statement key={f.id} message={f.message} sources={f.sources} />)}</ul>
      </ReportSection>
      <ReportSection number={k()} title="State at stop" fold={{ summary: "Show the recorded state of each run at its stop", open: false }}>
        <div className="grid gap-6 md:grid-cols-2">
          {c.evidence.states.map((s, i) => (
            <div key={i} className="min-w-0">
              <h3 className="font-semibold text-ink">{i === 0 ? "Earlier" : "Later"} · {c.runs[i]!.infrastructureName}</h3>
              {s ? <div className="mt-1 space-y-1">
                <p>Health: {s.health ?? "unknown"} · simulated second: {s.simulatedSeconds ?? "unknown"} · captured: {s.capturedAt ?? "unknown"}</p>
                <p>Topology revision: {s.topologyRevision ?? "unknown"} · measurement revision: {s.metricsTopologyRevision ?? "unknown"} · freshness: {s.measurementFreshness ?? "unknown"}</p>
                <p>Measurements computed at: {s.metricsComputedAt ?? "not recorded/computed"} · speed: {s.speed ?? "unknown"}×</p>
                <p>Restarting resources: {s.restarting ? s.restarting.join(", ") || "none" : "unknown"}</p>
                {s.activeChaos === undefined ? <p>Active faults: unknown.</p> : <ul className="list-disc pl-5">{s.activeChaos.map((f, j) => <li key={j}>{f.chaosType} on {f.resourceId}: {f.remainingTicks} simulated seconds remaining</li>)}</ul>}
                {s.installedSkus === undefined ? <p>Installed sizes: unknown.</p> : <ul className="list-disc pl-5">{Object.entries(s.installedSkus).map(([id, sku]) => <li key={id}>{id}: installed {sku}</li>)}</ul>}
                {s.pools === undefined ? <p>Pool state: unknown.</p> : <ul className="list-disc pl-5">{Object.values(s.pools).map((p) => <li key={p.lbId}>{p.lbId}: {p.currentReplicas} replicas ({p.minReplicas}–{p.maxReplicas}); {p.pending ? `${p.pending.action}, ${p.pending.secondsRemaining} s remaining` : "no pending change"}</li>)}</ul>}
              </div> : <p className="mt-1">No usable final evidence.</p>}
            </div>
          ))}
        </div>
      </ReportSection>
      <ReportSection number={k()} title="Gates and security" fold={{ summary: "Show both runs' recorded gate evidence", open: false }}>
        <div className="grid gap-6 md:grid-cols-2">{c.gates.map((stages, i) => (
          <div key={i}><h3 className="font-semibold text-ink">{i === 0 ? "Earlier" : "Later"}</h3>
            {stages.length ? stages.map((s, j) => <div key={j} className="mt-2"><p className="text-ink">{STAGE_LABEL[s.name] ?? s.name}: {STAGE_STATUS_LABEL[s.status] ?? s.status} · {s.message}</p><ul className="list-disc pl-5">{[...s.warnings, ...s.issues].map((m, k) => <li key={k}>{m}</li>)}</ul></div>) : <p>No usable recorded gate evidence.</p>}
          </div>))}
        </div>
      </ReportSection>
      <ReportSection number={k()} title="Detailed starting-input differences" fold={{ summary: "Show every recorded difference", open: false }}><StartingInputs starting={c.starting} detailed /></ReportSection>
      <ReportSection number={k()} title="Action differences" fold={{ summary: "Show both runs' recorded actions", open: false }}>
        <p>{c.conduct.speedNote}</p>
        {c.conduct.actions.map((actions, i) => <div key={i} className="mt-5"><h3 className="mb-2 font-semibold text-ink">{i === 0 ? "Earlier" : "Later"}</h3>{actions.length ? <ActionTimeline actions={actions} /> : <p>No durable actions recorded.</p>}</div>)}
      </ReportSection>
      <p className="mt-10 flex flex-wrap gap-5 text-sm">{c.runs.map((r, i) => <Link key={r.id} className="font-medium text-accent hover:underline" to={`/runs/${r.id}`}>{i === 0 ? "Earlier" : "Later"} full report and provenance</Link>)}</p>
    </article>
  );
}
import { ExperimentCompare } from "./ExperimentCompare";
