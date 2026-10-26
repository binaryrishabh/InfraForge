import { Link } from "react-router-dom";
import type { RunSummary } from "@infraforge/contracts/reports";
import { describeWorkload, formatDate } from "@/lib/format";
import { Button, ButtonLink } from "@/ui/Button";
import { EmptyState, Loading, Notice } from "@/ui/Page";
import { StatusMark } from "@/ui/StatusMark";
import { RESULT_LABEL } from "@/features/challenges/challengeLabels";
import { RunSelection } from "./RunSelection";
import { runKind, runStatus } from "../runKind";

function RunRow({ run, selected, onToggle }: { run: RunSummary; selected?: string[]; onToggle?: (id: string) => void }) {
  const status = runStatus(run.status);
  const kind = runKind(run);
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-t border-line py-[var(--if-list-y)] first:border-t-0 lg:grid-cols-[auto_minmax(0,1fr)_11rem_10rem]">
      <div className="pt-0.5">{selected && onToggle ? <RunSelection run={run} selected={selected} onToggle={onToggle} /> : <span />}</div>
      <div className="min-w-0">
        <p className="text-xs text-ink-3">{kind.label}{kind.detail && <> · <span className="text-ink-2">{kind.detail}</span></>}</p>
        <Link to={`/runs/${run.id}`} className="block truncate text-[16px] font-semibold text-ink underline-offset-4 hover:underline">{run.infrastructureName}</Link>
        <p className="mt-0.5 text-[13px] text-ink-3">
          <time dateTime={run.createdAt}>{formatDate(run.createdAt)}</time> · {run.resourceCount} {run.resourceCount === 1 ? "resource" : "resources"} recorded
          {run.chaosEventCount !== null && ` · ${run.chaosEventCount} chaos ${run.chaosEventCount === 1 ? "request" : "requests"}`}
        </p>
        {run.workload && <p className="mt-0.5 truncate text-xs text-ink-3">{describeWorkload(run.workload)}</p>}
        {run.infrastructureId === null && <p className="mt-0.5 text-xs text-ink-3">Saved design deleted; run history retained.</p>}
        {run.status === "live" && <Link to={`/design?run=${encodeURIComponent(run.id)}`} className="mt-1 mr-3 inline-block text-[13px] font-medium text-accent hover:underline">Open live run<span className="sr-only">: {run.infrastructureName}</span></Link>}
        <Link to={`/runs/${run.id}`} className="mt-1 inline-block text-[13px] font-medium text-accent hover:underline">
          {run.challenge ? "Read the result" : run.hasReportData ? "Understand this run" : "View inputs and evidence limits"}<span className="sr-only">: {run.infrastructureName}</span>
        </Link>
      </div>
      {/* Below the large breakpoint, status and result sit in one row under the title. */}
      <div className="col-start-2 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 lg:contents">
        <div><StatusMark kind={status.kind} label={status.label} /></div>
        <div>{run.challenge && <StatusMark size="sm" kind={run.challenge.status} label={`${RESULT_LABEL[run.challenge.status]}${run.challenge.total ? ` · ${run.challenge.metCount}/${run.challenge.total}` : ""}`} />}</div>
      </div>
    </li>
  );
}

export function RunList({ runs, selected, onToggle }: { runs: RunSummary[]; selected?: string[]; onToggle?: (id: string) => void }) {
  return <ul className="flex flex-col">{runs.map((run) => <RunRow key={run.id} run={run} selected={selected} onToggle={onToggle} />)}</ul>;
}

export function HistoryContent({ loading, error, runs, retry, selected, onToggle, emptyText }: {
  loading: boolean; error: string | null; runs: RunSummary[]; retry: () => void; selected?: string[]; onToggle?: (id: string) => void; emptyText?: string;
}) {
  if (loading) return <Loading label="Loading run history…" />;
  if (error) return <div role="alert" className="py-6"><Notice tone="fail">{error}</Notice><Button className="mt-3" size="sm" onClick={retry}>Try again</Button></div>;
  if (!runs.length) return (
    <EmptyState title="No runs recorded yet." action={<ButtonLink to="/design" variant="secondary" size="sm">Open the designer</ButtonLink>}>
      {emptyText ?? "Run a saved design or attempt a challenge, then come back here to read what the simulator recorded."}
    </EmptyState>
  );
  return <RunList runs={runs} selected={selected} onToggle={onToggle} />;
}
