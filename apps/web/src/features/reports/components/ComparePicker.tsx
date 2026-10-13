import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "../../../components/UI/Modal";
import { getCompareOptions } from "../../../api/reports.api";
import { useReportRequest } from "../useReportRequest";

function Options({ id }: { id: string }) {
  const load = useCallback(() => getCompareOptions(id), [id]);
  const { data, loading, error, retry } = useReportRequest(load);
  if (loading) return <p role="status">Loading eligible runs…</p>;
  if (error) return <div role="alert"><p>{error}</p><button onClick={retry}>Try again</button></div>;
  return <><p className="text-sm text-[#8B909C]">Related runs first, then the same surviving design. Up to 100 eligible runs; use history for older runs.</p>
    <ul className="mt-4 space-y-3">{data?.map((r) => <li key={r.id}><Link className="text-[#4FA89B] underline" to={`/reports/compare?a=${id}&b=${r.id}`}>{r.infrastructureName} · {r.status} · {new Date(r.createdAt).toLocaleString()}</Link></li>)}</ul>
    {!data?.length && <p>No other finished runs are available yet.</p>}</>;
}
export function ComparePicker({ id, eligible }: { id: string; eligible: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button className="text-[#4FA89B] underline disabled:text-[#8B909C]" disabled={!eligible} onClick={() => setOpen(true)}>Compare with…</button>
    {!eligible && <span className="text-xs text-[#8B909C]">Stop this run or wait for gates before comparing.</span>}
    <Modal open={open} onOpenChange={setOpen} title="Compare with another run" description="Choose one of your finished runs." footer={<button onClick={() => setOpen(false)}>Close</button>}>{open && <Options id={id} />}</Modal></>;
}
