import { useCallback } from "react";
import { Link } from "react-router-dom";
import { getRunFamily } from "../../../api/reports.api";
import { useReportRequest } from "../useReportRequest";
import { ReportSection } from "./ReportSection";

export function RunFamily({ id }: { id: string }) {
  const load = useCallback(() => getRunFamily(id), [id]);
  const { data, error, loading, retry } = useReportRequest(load);
  return <ReportSection title="Run family"><p>Source and direct reruns only; no inferred family links.</p>
    {loading && <p role="status">Loading lineage…</p>}{error && <div role="alert"><p>{error}</p><button onClick={retry}>Try again</button></div>}
    {data && <>{data.source ? <p>Source: <Link className="text-[#4FA89B] underline" to={`/reports/${data.source.id}`}>{data.source.infrastructureName}</Link></p> : <p>No retained source link.</p>}
      <ul className="mt-3 space-y-2">{data.reruns.map(({ run, starting }) => <li key={run.id}><Link className="text-[#4FA89B] underline" to={`/reports/${run.id}`}>{run.infrastructureName} · {run.status}</Link><p>Starting inputs: {starting.grade.replaceAll("-", " ")}</p></li>)}</ul>
      {!data.reruns.length && <p>No direct reruns yet.</p>}{data.truncated && <p>First {data.limit} direct reruns shown. Use history for other runs.</p>}</>}
  </ReportSection>;
}
