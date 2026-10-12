import { Link } from "react-router-dom";
import type { RunSummary } from "@infraforge/contracts/reports";

export function RunList({ runs }: { runs: RunSummary[] }) {
  return <ul className="divide-y divide-[#2A2E37]">
    {runs.map((run) => <li key={run.id}>
      <Link to={`/reports/${run.id}`} className="block p-4 rounded-lg hover:bg-[#2A2E37]/40 focus-visible:outline focus-visible:outline-[#4FA89B]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-[#EDEEF0]">{run.infrastructureName}</span>
          <span className="text-xs rounded bg-[#14161A] px-2 py-1 text-[#C3C7D0]">{run.status}</span>
        </div>
        <p className="mt-2 text-sm text-[#8B909C]">
          <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString()}</time> · {run.resourceCount} {run.resourceCount === 1 ? "resource" : "resources"} recorded
          {run.chaosEventCount !== null && ` · ${run.chaosEventCount} chaos request${run.chaosEventCount === 1 ? "" : "s"}`}
        </p>
        {run.workload && <p className="mt-1 text-xs text-[#8B909C]">{run.workload.targetThroughput.toLocaleString()} requests {run.workload.throughputUnit.replaceAll("-", " ")} · {run.workload.trafficShape} traffic</p>}
        <p className="mt-2 text-sm text-[#4FA89B]">{run.hasReportData ? "Understand this run →" : "View inputs and evidence limits →"}</p>
      </Link>
    </li>)}
  </ul>;
}

export function HistoryContent({ loading, error, runs, retry }: { loading: boolean; error: string | null; runs: RunSummary[]; retry: () => void }) {
  if (loading) return <p role="status" className="p-6 text-[#C3C7D0]">Loading run history…</p>;
  if (error) return <div role="alert" className="p-6 space-y-3"><p>{error}</p><button onClick={retry} className="text-[#4FA89B] underline">Try again</button></div>;
  if (!runs.length) return <div className="p-6 space-y-3"><p>No runs recorded yet.</p><p className="text-sm text-[#8B909C]">Deploy a saved design, observe it, then come back to understand the recorded outcome.</p><Link className="text-[#4FA89B] underline" to="/design">Open the designer</Link></div>;
  return <RunList runs={runs} />;
}
