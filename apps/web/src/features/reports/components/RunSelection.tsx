import type { RunSummary } from "@infraforge/contracts/reports";
import { ButtonLink } from "@/ui/Button";
import { selectionReason } from "../selection";

export function RunSelection({ run, selected, onToggle }: { run: RunSummary; selected: string[]; onToggle: (id: string) => void }) {
  const reason = selectionReason(run);
  const full = selected.length === 2 && !selected.includes(run.id);
  const blocked = reason ?? (full ? "Clear one selected run to select another." : null);
  return (
    <label className="flex size-6 items-center justify-center" title={blocked ?? `Select ${run.infrastructureName} to compare`}>
      <input type="checkbox" className="size-4 accent-[var(--if-ink)]" checked={selected.includes(run.id)} disabled={!!blocked} onChange={() => onToggle(run.id)}
        aria-label={`Select ${run.infrastructureName} for comparison`} aria-describedby={blocked ? `why-${run.id}` : undefined} />
      {blocked && <span id={`why-${run.id}`} className="sr-only">{blocked}</span>}
    </label>
  );
}

export function CompareSelection({ selected }: { selected: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="status" aria-live="polite" className="text-sm text-ink-2">{selected.length} of 2 runs selected. {selected.length === 1 ? "Select a second run." : selected.length === 0 ? "Tick two runs to compare them." : ""}</p>
      {selected.length === 2 && <ButtonLink variant="primary" size="sm" to={`/runs/compare?a=${encodeURIComponent(selected[0]!)}&b=${encodeURIComponent(selected[1]!)}`}>Compare selected runs</ButtonLink>}
    </div>
  );
}
