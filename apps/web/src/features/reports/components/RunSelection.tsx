import { Link } from "react-router-dom";
import type { RunSummary } from "@infraforge/contracts/reports";
import { selectionReason } from "../selection";

export function RunSelection({ run, selected, onToggle }: { run: RunSummary; selected: string[]; onToggle: (id: string) => void }) {
  const reason = selectionReason(run);
  const full = selected.length === 2 && !selected.includes(run.id);
  return <div className="px-4 pt-3"><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={selected.includes(run.id)} disabled={!!reason || full} onChange={() => onToggle(run.id)} />Select {run.infrastructureName}</label>
    {(reason || full) && <p className="text-xs text-[#8B909C]">{reason ?? "Clear one selected run to select another."}</p>}</div>;
}
export function CompareSelection({ selected }: { selected: string[] }) {
  return <div className="p-4 space-y-2"><p role="status" aria-live="polite">{selected.length} of 2 runs selected. {selected.length === 1 ? "Select a second run." : ""}</p>
    {selected.length === 2 && <Link className="text-[#4FA89B] underline" to={`/reports/compare?a=${encodeURIComponent(selected[0]!)}&b=${encodeURIComponent(selected[1]!)}`}>Compare selected runs</Link>}</div>;
}
