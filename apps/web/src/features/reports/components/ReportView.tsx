import { useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, GitCompareArrows } from "lucide-react";
import type { RunReport } from "@infraforge/contracts/reports";
import { getChallenge } from "@/api/challenges.api";
import { useRequest } from "@/api/useRequest";
import { describeWorkload, formatDate, plural } from "@/lib/format";
import { ButtonLink } from "@/ui/Button";
import { Notice } from "@/ui/Page";
import { StatusMark } from "@/ui/StatusMark";
import { ChallengeDebrief } from "@/features/challenges/components/ChallengeDebrief";
import { ReportSection, Statement } from "./ReportSection";
import { ReportMeasurements } from "./ReportMeasurements";
import { ActionTimeline } from "./ActionTimeline";
import { ComparePicker } from "./ComparePicker";
import { RerunDialog } from "./RerunDialog";
import { RunFamily } from "./RunFamily";
import { OpenDesignToImprove } from "./OpenDesignToImprove";
import { runKind, runStatus } from "../runKind";
import { STAGE_LABEL, STAGE_STATUS_LABEL } from "../labels";

const active = (status: string) => ["pending", "running", "live"].includes(status);

function Debrief({ report }: { report: RunReport }) {
  const { challengeId: id, version } = report.challenge!;
  // The exact version this attempt was judged by, so labels and the explanation match its rules.
  const load = useCallback(() => getChallenge(id, version || undefined), [id, version]);
  const { data } = useRequest(load);
  return <ChallengeDebrief evaluation={report.challenge!} brief={data} runId={report.run.id} />;
}

/* A lab report: what ran, the challenge verdict if any, what was recorded,
the final state, the gates, the actions, lineage, and the limits of the evidence. */
export function ReportView({ report }: { report: RunReport }) {
  const { run, topology } = report;
  const status = runStatus(run.status);
  const kind = runKind(run);
  const eligible = !active(run.status);
  const snapshot = report.terminal ?? report.checkpoint;
  const hasCost = report.stages.some((st) => st.monthlyEstimateUsd !== undefined) || snapshot?.accumulatedCostUsd !== undefined;
  // Section numbers follow only the sections this report actually shows.
  let n = 0;
  const head = { ran: ++n, observed: ++n, interpreted: report.interpreted.length ? ++n : 0, measurements: n + 1 };
  n += (snapshot ? 1 : 0) + (hasCost ? 1 : 0);
  const num = {
    ...head,
    stages: report.stages.length ? ++n : 0, actions: report.actions.length ? ++n : 0, chaos: report.chaosEvents.length ? ++n : 0,
    topology: run.topologyRevision && topology.changes ? ++n : 0, timeline: report.timeline.length ? ++n : 0,
    lineage: ++n, unknown: ++n, next: n + 1,
  };
  return (
    <article className="pt-6">
      <Link to="/runs" className="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink"><ArrowLeft size={14} aria-hidden="true" /> Runs</Link>
      <header className="mt-4">
        <p className="if-eyebrow">{kind.label}{kind.detail ? ` · ${kind.detail}` : ""}</p>
        <h1 className="if-display mt-2 text-[34px] sm:text-[42px]">{run.infrastructureName}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
          <StatusMark kind={status.kind} label={status.label} />
          <span>Started <time dateTime={run.createdAt}>{formatDate(run.createdAt)}</time></span>
          <span>{run.resourceCount} {run.resourceCount === 1 ? "resource" : "resources"} recorded</span>
          <span className="text-ink-3">Last record update <time dateTime={run.updatedAt}>{formatDate(run.updatedAt)}</time></span>
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <RerunDialog id={run.id} eligible={eligible} experimentChallenge={report.challenge?.experiment ? report.challenge.challengeId : null} />
          <ComparePicker id={run.id} eligible={eligible} />
          {!run.challenge && <OpenDesignToImprove sourceId={run.id} designId={run.infrastructureId} eligible={eligible} />}
          {run.sourceRunId && eligible && <ButtonLink to={`/runs/compare?a=${run.sourceRunId}&b=${run.id}`} variant="ghost" size="sm" icon={<GitCompareArrows size={14} aria-hidden="true" />}>Compare with source run</ButtonLink>}
        </div>
        {run.status === "live" && <Notice className="mt-4" tone="info">This run is still live. The report shows retained evidence, not a live monitor.</Notice>}
        {!run.hasReportData && <Notice className="mt-4" tone="warn">No usable stages, events or checkpoint data were retained for this run.</Notice>}
      </header>

      {report.challenge && <Debrief report={report} />}

      <ReportSection number={num.ran} title="What ran">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-[13px] font-semibold text-ink">Workload</h3>
            {run.workload ? <p className="mt-1 text-[15px] text-ink">{describeWorkload(run.workload)}</p> : <p className="mt-1">Not recorded.</p>}
            <p className="mt-1 text-xs text-ink-3">{run.workloadSource === "captured" ? "Captured when the run was created." : run.workloadSource === "legacy" ? "Legacy workload record; the full resolved input is unavailable." : "Unavailable."}</p>
            <dl className="mt-3 grid gap-1 text-xs">
              {report.originalSeed && <div className="flex gap-2"><dt className="text-ink-3">Seed</dt><dd className="if-num break-all text-ink-2">{report.originalSeed}</dd></div>}
              {report.legacySeed && <div className="flex gap-2"><dt className="text-ink-3">Legacy seed record</dt><dd className="if-num break-all text-ink-2">{report.legacySeed} (original input unavailable)</dd></div>}
              <div className="flex gap-2"><dt className="text-ink-3">Model · catalog</dt><dd className="if-num text-ink-2">{report.provenance.simulationModelVersion ?? "not captured (legacy input)"} · {report.provenance.catalogSnapshot ?? "not captured"}</dd></div>
            </dl>
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-ink">Original architecture</h3>
            {topology.original ? <>
              <p className="mt-1 text-xs text-ink-3">{plural(topology.original.resources.length, "resource")}, {plural(topology.original.connectionCount, "connection")}</p>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {topology.original.resources.map((r) => <li key={r.id} className="flex justify-between gap-3 py-1.5"><span className="text-ink">{r.name}</span><span className="if-num text-xs text-ink-3">{r.type}{r.skuId && ` · ${r.skuId}`}</span></li>)}
              </ul>
            </> : <p className="mt-1">No immutable run input was retained.</p>}
          </div>
        </div>
      </ReportSection>

      <ReportSection number={num.observed} title="Observed — recorded facts">
        <ul className="flex flex-col gap-3">{report.observed.map((f) => <Statement key={f.id} message={f.message} sources={f.sources} />)}</ul>
      </ReportSection>
      {report.interpreted.length > 0 && (
        <ReportSection number={num.interpreted} title="Interpreted — what the evidence supports">
          <ul className="flex flex-col gap-3">{report.interpreted.map((f) => <Statement key={f.id} message={f.message} sources={f.sources} verb="Derived from" />)}</ul>
        </ReportSection>
      )}

      <ReportMeasurements report={report} number={num.measurements} />

      {report.stages.length > 0 && (
        <ReportSection number={num.stages} title="Deployment stages">
          <ol className="flex flex-col gap-3">
            {report.stages.map((stage, i) => (
              <li key={`${stage.name}:${i}`} className="border-l-2 border-line-strong pl-3">
                <p className="flex flex-wrap items-center gap-3"><span className="font-semibold text-ink">{STAGE_LABEL[stage.name] ?? stage.name}</span><StatusMark size="sm" kind={stage.status === "completed" ? "finished" : stage.status === "failed" ? "failed" : "pending"} label={STAGE_STATUS_LABEL[stage.status] ?? stage.status} /></p>
                <p className="text-ink">{stage.message}</p>
                {[...stage.warnings, ...stage.issues].map((m, j) => <p key={j} className="mt-0.5 text-warn">{m}</p>)}
                <time className="text-xs text-ink-3" dateTime={stage.completedAt}>{formatDate(stage.completedAt)}</time>
              </li>
            ))}
          </ol>
        </ReportSection>
      )}

      {report.actions.length > 0 && (
        <ReportSection number={num.actions} title="Actions" aside={`${report.actions.length} shown`} fold={report.actions.length > 5 ? { summary: `Show all ${report.actions.length} actions`, open: false } : undefined}>
          <ActionTimeline actions={report.actions} />
        </ReportSection>
      )}

      {report.chaosEvents.length > 0 && (
        <ReportSection number={num.chaos} title="Chaos requests">
          <p className="text-ink-3">These are recorded requests. Full impact and recovery are not proven by a request alone.</p>
          <ol className="mt-3 flex flex-col gap-2">{report.chaosEvents.map((e, i) => <li key={i} className="border-l-2 border-line-strong pl-3"><p className="text-ink">{e.type} on {e.resourceId}</p><p>{e.message}</p><time className="text-xs text-ink-3" dateTime={e.timestamp}>{formatDate(e.timestamp)}</time></li>)}</ol>
        </ReportSection>
      )}

      {!!run.topologyRevision && topology.changes && (
        <ReportSection number={num.topology} title="Last accepted topology changes">
          <p>Revision {run.topologyRevision}, compared with the original input. The action list and snapshot revision show whether the simulator had applied it.</p>
          <dl className="mt-2 grid gap-1 sm:grid-cols-2">
            <div><dt className="text-xs text-ink-3">Added</dt><dd className="text-ink">{topology.changes.added.join(", ") || "none"}</dd></div>
            <div><dt className="text-xs text-ink-3">Removed</dt><dd className="text-ink">{topology.changes.removed.join(", ") || "none"}</dd></div>
            <div><dt className="text-xs text-ink-3">Reconfigured</dt><dd className="text-ink">{topology.changes.reconfigured.join(", ") || "none"}</dd></div>
            <div><dt className="text-xs text-ink-3">Connections</dt><dd className="text-ink">{topology.changes.addedConnections} added, {topology.changes.removedConnections} removed</dd></div>
          </dl>
        </ReportSection>
      )}

      {report.timeline.length > 0 && (
        <ReportSection number={num.timeline} title="Recorded timeline" fold={{ summary: `${report.timeline.length} recorded lifecycle events`, open: report.timeline.length <= 6 }}>
          <ol className="flex flex-col gap-2">{report.timeline.map((e, i) => <li key={i}><p className="font-medium text-ink">{e.event}</p><p>{e.message}</p><time className="text-xs text-ink-3" dateTime={e.timestamp}>{formatDate(e.timestamp)}</time></li>)}</ol>
        </ReportSection>
      )}

      <ReportSection number={num.lineage} title="Lineage"><RunFamily id={run.id} /></ReportSection>

      <ReportSection number={num.unknown} title="Unknown — evidence limits">
        <ul className="list-disc space-y-2 pl-5">{report.unknown.map((limit) => <li key={limit}>{limit}</li>)}</ul>
      </ReportSection>
      <ReportSection number={num.next} title="What to inspect next">
        <ul className="list-disc space-y-2 pl-5">{report.inspectNext.map((step) => <li key={step}>{step}</li>)}</ul>
      </ReportSection>
    </article>
  );
}
