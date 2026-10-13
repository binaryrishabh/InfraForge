import { Link } from "react-router-dom";
import type { ReportStatement, RunComparison } from "@infraforge/contracts/reports";
import { ReportSection as Section } from "./ReportSection";
import { CompareMetrics } from "./CompareMetrics";
import { StartingInputs } from "./StartingInputs";
import { ActionTimeline } from "./ActionTimeline";

function Findings({ title, facts }: { title: string; facts: ReportStatement[] }) {
  return <Section title={title} open><ul className="space-y-3">{facts.map((f) => <li key={f.id}><p>{f.message}</p><p className="text-xs text-[#8B909C]">Source: {f.sources.join(", ")}</p></li>)}</ul></Section>;
}
export function CompareContent({ loading, error, data, retry }: { loading: boolean; error: string | null; data: RunComparison | null; retry: () => void }) {
  if (loading) return <p role="status">Loading comparison…</p>;
  if (error || !data) return <div role="alert"><p>{error ?? "Comparison unavailable."}</p><button className="text-[#4FA89B] underline" onClick={retry}>Try again</button><p><Link to="/reports">Run history</Link></p></div>;
  return <CompareView comparison={data} />;
}
export function CompareView({ comparison: c }: { comparison: RunComparison }) {
  return <div className="space-y-5 min-w-0 break-words">
    <Link to="/reports" className="text-[#4FA89B]">← Run history</Link><h1 className="text-2xl font-semibold">Compare two runs</h1>
    <div className="flex flex-col sm:flex-row gap-5">{c.runs.map((r, i) => <div key={r.id} className="flex-1 min-w-0"><p className="text-sm text-[#8B909C]">{i === 0 ? "Earlier" : "Later"}</p><Link className="font-medium text-[#4FA89B]" to={`/reports/${r.id}`}>{r.infrastructureName}</Link><p>{r.status} · {new Date(r.createdAt).toLocaleString()}</p><p className="text-xs break-all">{r.id}</p></div>)}</div>
    {!c.available && <p role="status">{c.unavailableReason}</p>}
    <Section title="How comparable" open><p>{c.headline.replaceAll("-", " ")}</p><p>Conduct: {c.conduct.code} · final evidence: {c.evidence.code.replaceAll("-", " ")} · lineage: {c.lineage.replaceAll("-", " ")}</p><p>{c.conduct.speedNote}</p></Section>
    <Section title="What stayed the same / changed" open><StartingInputs starting={c.starting} /></Section>
    <Section title="What this pair cannot show" open><p>A single pair cannot establish statistical significance, production reliability, real cloud behavior or general superiority across seeds. Same seed alone is not a perfectly controlled comparison.</p></Section>
    <Findings title="Observed — recorded facts" facts={c.observed} />
    {!!c.interpreted.length && <Findings title="Interpreted — what the evidence supports" facts={c.interpreted} />}
    <Findings title="Unknown — evidence limits" facts={c.unknown} />
    <Section title="Final-state differences" open><CompareMetrics metrics={c.outcomes} caption="Recorded stop state" />
      {c.resources.map((r) => <div key={r.id} className="mt-5"><h3 className="font-medium">{r.id}</h3><p>Health: earlier {r.earlierHealth ?? "unknown"} / later {r.laterHealth ?? "unknown"}</p><CompareMetrics metrics={r.metrics} caption={`Retained resource measurements: ${r.id}`} /></div>)}
    </Section>
    <Section title="Cost" open><p className="mb-3 text-sm text-[#8B909C]">Educational/model output, not a cloud bill. Hourly burn, accumulated cost and design monthly estimate are separate measures.</p><CompareMetrics metrics={c.costs} caption="Simulated costs and gate estimate" /></Section>
    <Section title="State at stop"><div className="space-y-5">{c.evidence.states.map((s, i) => <div key={i}><h3 className="font-medium">{i === 0 ? "Earlier" : "Later"} · {c.runs[i]!.infrastructureName}</h3>{s ? <>
      <p>Health: {s.health ?? "unknown"} · captured at: {s.capturedAt ?? "unknown"} · simulated second: {s.simulatedSeconds ?? "unknown"}</p>
      <p>Topology revision: {s.topologyRevision ?? "unknown"} · measurement revision: {s.metricsTopologyRevision ?? "unknown"} · freshness: {s.measurementFreshness ?? "unknown"}</p>
      <p>Measurements computed at: {s.metricsComputedAt ?? "not recorded/computed"} · speed: {s.speed ?? "unknown"}×</p>
      <p>Restarting resources: {s.restarting ? s.restarting.join(", ") || "none" : "unknown"}</p>
      {s.activeChaos === undefined && <p>Active faults: unknown.</p>}
      {s.pools === undefined && <p>Pool state: unknown.</p>}
      {s.installedSkus === undefined && <p>Installed SKUs: unknown.</p>}
      <ul>{s.activeChaos?.map((f, j) => <li key={j}>{f.chaosType} on {f.resourceId}: {f.remainingTicks} simulated seconds remaining</li>)}</ul>
      <ul>{Object.entries(s.installedSkus ?? {}).map(([id, sku]) => <li key={id}>{id}: installed {sku}</li>)}</ul>
      <ul>{Object.values(s.pools ?? {}).map((p) => <li key={p.lbId}>{p.lbId}: {p.currentReplicas} replicas ({p.minReplicas}–{p.maxReplicas}); {p.pending ? `${p.pending.action}, ${p.pending.secondsRemaining} s remaining` : "no pending change"}</li>)}</ul>
    </> : <p>No usable final evidence.</p>}</div>)}</div></Section>
    <Section title="Gate / security changes"><div className="space-y-5">{c.gates.map((stages, i) => <div key={i}><h3>{i === 0 ? "Earlier" : "Later"}</h3>{stages.length ? stages.map((s, j) => <div key={j}><p>{s.name}: {s.status} · {s.message}</p><ul>{[...s.warnings, ...s.issues].map((m, k) => <li key={k}>{m}</li>)}</ul></div>) : <p>No usable recorded gate evidence.</p>}</div>)}</div></Section>
    <Section title="Detailed starting-input diff"><StartingInputs starting={c.starting} detailed /></Section>
    <Section title="Action / conduct diff"><p>{c.conduct.speedNote}</p>{c.conduct.actions.map((actions, i) => <div key={i} className="mt-5"><h3>{i === 0 ? "Earlier" : "Later"}</h3>{actions.length ? <ActionTimeline actions={actions} /> : <p>No durable actions recorded.</p>}</div>)}</Section>
    <p className="flex flex-wrap gap-5">{c.runs.map((r, i) => <Link key={r.id} className="text-[#4FA89B] underline" to={`/reports/${r.id}`}>{i === 0 ? "Earlier" : "Later"} full report and provenance</Link>)}</p>
  </div>;
}
