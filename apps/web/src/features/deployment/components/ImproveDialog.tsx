import { useCallback, useState, type FormEvent } from "react";
import { RefreshCw, Play } from "lucide-react";
import type { RerunOptions } from "@infraforge/contracts/reports";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import { INFRASTRUCTURE_NAME_MAX_LENGTH, validateInfrastructureName } from "@infraforge/domain/validation";
import { previewCanvasRerun } from "@/api/reports.api";
import { useRequest } from "@/api/useRequest";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { Field, Input } from "@/ui/Field";
import { Loading, Notice } from "@/ui/Page";
import { StartingInputs } from "@/features/reports/components/StartingInputs";
import { SourceInputFacts } from "@/features/reports/components/SourceInputFacts";
import type { CanvasRerunRequest } from "@/features/canvas/improvement";

/* What the improved run will and will not reuse from its source. */
export function CanvasMatchPreview({ options }: { options: RerunOptions }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="font-semibold text-ink">Match {options.source.infrastructureName}</p>
        <p className="mt-1 text-ink-2">The source run's workload and seed are reused. Original run actions are NOT replayed.</p>
      </div>
      <SourceInputFacts workload={options.workload} seed={options.seed} />
      <p className="text-ink-2">This previews the current canvas, including unsaved edits. Running saves this canvas to the original design first, then captures the new run. If the saved design changes after this preview, the changed preview is refused; refresh it and try again.</p>
      {!options.currentDesign.available && <Notice tone="warn">{options.currentDesign.reason}</Notice>}
      {options.currentDesign.available && !options.currentDesign.modelCatalogCompatible && (
        <Notice tone="warn">Model or catalog provenance differs or is missing, so the resulting comparison is descriptive only.</Notice>
      )}
      {options.currentDesign.preview && <StartingInputs starting={options.currentDesign.preview} detailed />}
    </div>
  );
}

function Form({ options, initialName, loading, refresh, onRun }: { options: RerunOptions; initialName: string; loading: boolean; refresh: () => void; onRun: (name: string, matchedStop: boolean, hash: string) => void }) {
  const [name, setName] = useState(initialName);
  const [matched, setMatched] = useState(options.matchedStop.defaultEnabled);
  const [error, setError] = useState<string | null>(null);
  const runnable = options.currentDesign.available && !!options.currentDesign.inputHash;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const invalid = validateInfrastructureName(name);
    if (invalid) { setError(invalid); return; }
    if (!loading && runnable) onRun(name.trim(), matched, options.currentDesign.inputHash!);
  };
  return (
    <form id="improve-form" onSubmit={submit} className="flex flex-col gap-5">
      <fieldset disabled={loading} className="flex flex-col gap-5">
        <Field label="Design name" error={error}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoFocus value={name} maxLength={INFRASTRUCTURE_NAME_MAX_LENGTH} onChange={(e) => { setName(e.target.value); setError(null); }} />}
        </Field>
        <CanvasMatchPreview options={options} />
        <label className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 accent-[var(--if-ink)]" checked={matched} disabled={!options.matchedStop.available} onChange={(e) => setMatched(e.target.checked)} />
          <span>Stop automatically at the same simulated time as the source run{options.matchedStop.target !== null && <span className="if-num"> ({options.matchedStop.target} s)</span>}.
            {options.matchedStop.reason && <span className="mt-0.5 block text-xs text-ink-3">{options.matchedStop.reason}</span>}</span>
        </label>
      </fieldset>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden="true" />} onClick={refresh} disabled={loading}>Refresh preview</Button>
        <Button type="submit" variant="primary" loading={loading} disabled={!runnable} icon={<Play size={14} aria-hidden="true" />}>Save canvas and run again</Button>
      </div>
    </form>
  );
}

export function ImproveDialog({ sourceId, designId, layout, initialName, loading, onClose, onRun }: {
  sourceId: string; designId: string; layout: RunTopology; initialName: string; loading: boolean; onClose: () => void; onRun: (name: string, request: CanvasRerunRequest) => void;
}) {
  const load = useCallback(() => previewCanvasRerun(sourceId, layout), [sourceId, layout]);
  const { data, loading: previewing, error, retry } = useRequest(load, "The canvas preview could not be produced. The source run or your session may be unavailable.");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} busy={loading} guarded size="lg" eyebrow="Improve a recorded run" title="Run again with this canvas"
      description="Preview what changed against the source run before anything is saved.">
      {previewing && <Loading label="Previewing the current canvas…" />}
      {error && <div role="alert"><Notice tone="fail">{error}</Notice><Button className="mt-3" size="sm" onClick={retry}>Try again</Button></div>}
      {data && !previewing && (data.source.infrastructureId !== designId
        ? <Notice tone="fail" role="alert">This canvas is no longer the source run's design. Choose “Run normally instead” to run it without the source context.</Notice>
        : <Form options={data} initialName={initialName} loading={loading} refresh={retry} onRun={(name, matchedStop, inputHash) => onRun(name, { sourceId, designId, layout, matchedStop, inputHash })} />)}
    </Dialog>
  );
}
