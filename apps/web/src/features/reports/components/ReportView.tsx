import { Link } from "react-router-dom";
import type { RunReport } from "@infraforge/contracts/reports";
import { ReportSection as Section } from "./ReportSection";
import { ReportMeasurements } from "./ReportMeasurements";
import { ActionTimeline } from "./ActionTimeline";
import { ComparePicker } from "./ComparePicker";
import { RerunDialog } from "./RerunDialog";
import { RunFamily } from "./RunFamily";
import { OpenDesignToImprove } from "./OpenDesignToImprove";

export function ReportView({ report }: { report: RunReport }) {
  const { run, topology } = report;
  return <div className="space-y-5">
    <Link to="/reports" className="text-sm text-[#4FA89B] hover:underline">← Run history</Link>
    <div>
      <h1 className="text-2xl font-semibold">{run.infrastructureName}</h1>
      <p className="mt-2 text-[#C3C7D0]">{run.status} · {run.resourceCount} {run.resourceCount === 1 ? "resource" : "resources"} recorded</p>
      <p className="mt-1 text-sm text-[#8B909C]">Created <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString()}</time></p>
      <p className="text-sm text-[#8B909C]">Last run record update <time dateTime={run.updatedAt}>{new Date(run.updatedAt).toLocaleString()}</time></p>
      {run.status === "live" && <p className="mt-3 text-sm text-[#C3C7D0]">This run is still live. This report shows retained evidence, not a live monitor.</p>}
      {!run.hasReportData && <p className="mt-3 text-sm text-[#C3C7D0]">No usable stages, events or checkpoint data were retained for this run.</p>}
    </div>
    <div className="flex flex-wrap gap-3 items-center"><RerunDialog id={run.id} eligible={!["pending", "running", "live"].includes(run.status)} /><ComparePicker id={run.id} eligible={!["pending", "running", "live"].includes(run.status)} />
      <OpenDesignToImprove sourceId={run.id} designId={run.infrastructureId} eligible={!["pending", "running", "live"].includes(run.status)} />
      {run.sourceRunId && !["pending", "running", "live"].includes(run.status) && <Link className="text-[#4FA89B] underline" to={`/reports/compare?a=${run.sourceRunId}&b=${run.id}`}>Compare with source run</Link>}
    </div>
    <RunFamily id={run.id} />
    <Section title="Observed — recorded facts" open>
      <ul className="space-y-3">{report.observed.map((fact) => <li key={fact.id}>
        <p>{fact.message}</p><p className="text-xs text-[#8B909C]">Source: {fact.sources.join(", ")}</p>
      </li>)}</ul>
    </Section>
    {!!report.interpreted.length && <Section title="Interpreted — what the evidence supports" open>
      <ul className="space-y-3">{report.interpreted.map((fact) => <li key={fact.id}>
        <p>{fact.message}</p><p className="text-xs text-[#8B909C]">Derived from: {fact.sources.join(", ")}</p>
      </li>)}</ul>
    </Section>}
    {run.workload && <Section title="Workload and original run input">
      <p>{run.workload.targetThroughput.toLocaleString()} requests {run.workload.throughputUnit.replaceAll("-", " ")} · {run.workload.trafficShape} traffic · {run.workload.payloadSize} payload</p>
      {run.workload.peakMultiplier !== undefined && <p>Peak multiplier: {run.workload.peakMultiplier}×</p>}
      {run.workload.readWriteRatio !== undefined && <p>Read share: {Math.round(run.workload.readWriteRatio * 100)}%</p>}
      <p className="text-[#8B909C]">{run.workloadSource === "captured" ? "Workload captured when this run was created." : "Legacy workload record; full resolved original input is unavailable."}</p>
      {report.originalSeed && <p className="break-all">Original seed: {report.originalSeed}</p>}
      <p>Simulation model: {report.provenance.simulationModelVersion ?? "not captured (legacy input)"} · catalog snapshot: {report.provenance.catalogSnapshot ?? "not captured"}</p>
      {report.legacySeed && <p className="break-all">Legacy seed record: {report.legacySeed} (original input unavailable)</p>}
      {topology.original && <>
        <p>Original architecture: {topology.original.resources.length} resources, {topology.original.connectionCount} connections</p>
        <ul className="space-y-1">{topology.original.resources.map((resource) => <li key={resource.id}>
          {resource.name} · {resource.type}{resource.skuId && ` · ${resource.skuId}`}
        </li>)}</ul>
      </>}
    </Section>}
    <ActionTimeline actions={report.actions} />
    {!!report.stages.length && <Section title="Deployment stages">
      <ol className="space-y-4">{report.stages.map((stage, i) => <li key={`${stage.name}:${i}`}>
        <p className="font-medium">{stage.name} · {stage.status}</p>
        <p>{stage.message}</p>
        <time className="text-xs text-[#8B909C]" dateTime={stage.completedAt}>{new Date(stage.completedAt).toLocaleString()}</time>
        {[...stage.warnings, ...stage.issues].map((message, j) => <p key={j} className="mt-1 text-[#E5BE78]">{message}</p>)}
      </li>)}</ol>
    </Section>}
    {!!report.timeline.length && <Section title="Recorded timeline">
      <ol className="space-y-4">{report.timeline.map((event, i) => <li key={i}>
        <p className="font-medium">{event.event}</p><p>{event.message}</p>
        <time className="text-xs text-[#8B909C]" dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time>
      </li>)}</ol>
    </Section>}
    {!!report.chaosEvents.length && <Section title="Chaos requests">
      <p className="text-[#8B909C]">These are recorded requests. Full impact and recovery are not proven by a request alone.</p>
      <ol className="space-y-4">{report.chaosEvents.map((event, i) => <li key={i}>
        <p>{event.type} on {event.resourceId}</p><p>{event.message}</p>
        <time className="text-xs text-[#8B909C]" dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time>
      </li>)}</ol>
    </Section>}
    {!!run.topologyRevision && topology.changes && <Section title="Last accepted topology changes">
      <p>Revision {run.topologyRevision}, compared with the original input. Use the action timeline and snapshot revision for retained evidence of simulator application.</p>
      <p>Added: {topology.changes.added.join(", ") || "none"}</p>
      <p>Removed: {topology.changes.removed.join(", ") || "none"}</p>
      <p>Reconfigured: {topology.changes.reconfigured.join(", ") || "none"}</p>
      <p>Connections: {topology.changes.addedConnections} added, {topology.changes.removedConnections} removed</p>
    </Section>}
    <ReportMeasurements report={report} />
    <Section title="Unknown — evidence limits" open>
      <ul className="list-disc pl-5 space-y-3">{report.unknown.map((limit) => <li key={limit}>{limit}</li>)}</ul>
    </Section>
    <Section title="What to inspect next" open>
      <ul className="list-disc pl-5 space-y-3">{report.inspectNext.map((step) => <li key={step}>{step}</li>)}</ul>
    </Section>
  </div>;
}
