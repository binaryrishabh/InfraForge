import { useCallback } from "react";
import { Link } from "react-router-dom";
import { getRunFamily } from "@/api/reports.api";
import { useRequest } from "@/api/useRequest";
import { Loading } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { StatusMark } from "@/ui/StatusMark";
import { GRADE_LABEL } from "../labels";
import { runStatus } from "../runKind";

/* Recorded lineage only: this run's source and its direct reruns. */
export function RunFamily({ id }: { id: string }) {
  const load = useCallback(() => getRunFamily(id), [id]);
  const { data, error, loading, retry } = useRequest(load, "Lineage could not be loaded.");
  if (loading) return <Loading label="Loading lineage…" />;
  if (error || !data) return <div role="alert"><p>{error}</p><Button className="mt-2" size="sm" onClick={retry}>Try again</Button></div>;
  return (
    <div className="flex flex-col gap-3">
      <p>{data.source ? <>Source run: <Link className="font-medium text-accent hover:underline" to={`/runs/${data.source.id}`}>{data.source.infrastructureName}</Link></> : "No retained source link."}</p>
      {data.reruns.length === 0 ? <p className="text-ink-3">No direct reruns yet.</p> : (
        <ul className="divide-y divide-line border-y border-line">
          {data.reruns.map(({ run, starting }) => {
            const s = runStatus(run.status);
            return (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link className="font-medium text-accent hover:underline" to={`/runs/${run.id}`}>{run.infrastructureName}</Link>
                <span className="flex items-center gap-3 text-xs text-ink-3">{GRADE_LABEL[starting.grade]} <StatusMark size="sm" kind={s.kind} label={s.label} /></span>
              </li>
            );
          })}
        </ul>
      )}
      {data.truncated && <p className="text-xs text-ink-3">The first {data.limit} direct reruns are shown. Use Runs for others.</p>}
    </div>
  );
}
