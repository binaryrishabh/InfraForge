import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { GitCompareArrows } from "lucide-react";
import { getCompareOptions } from "@/api/reports.api";
import { useRequest } from "@/api/useRequest";
import { formatDate } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Loading } from "@/ui/Page";
import { runKind, runStatus } from "../runKind";

function Options({ id }: { id: string }) {
  const load = useCallback(() => getCompareOptions(id), [id]);
  const { data, loading, error, retry } = useRequest(load, "Eligible runs could not be loaded.");
  if (loading) return <Loading label="Loading eligible runs…" />;
  if (error) return <div role="alert"><p>{error}</p><Button className="mt-2" size="sm" onClick={retry}>Try again</Button></div>;
  return (
    <>
      <p className="text-sm text-ink-3">Related runs first, then runs of the same design, then other finished runs (up to 100).</p>
      {!data?.length ? <p className="mt-4 text-sm text-ink-2">No other finished runs are available yet.</p> : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {data.map((r) => (
            <li key={r.id}><Link className="block py-2.5 hover:bg-sunken" to={`/runs/compare?a=${id}&b=${r.id}`}>
              <span className="block font-medium text-ink">{r.infrastructureName}</span>
              <span className="block text-xs text-ink-3">{runKind(r).label} · {runStatus(r.status).label} · {formatDate(r.createdAt)}</span>
            </Link></li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ComparePicker({ id, eligible }: { id: string; eligible: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" disabled={!eligible} icon={<GitCompareArrows size={14} aria-hidden="true" />} onClick={() => setOpen(true)}
        title={eligible ? undefined : "Stop this run or wait for gates before comparing."}>Compare with…</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Compare with another run" description="Choose one of your finished runs.">{open && <Options id={id} />}</Dialog>
    </>
  );
}
