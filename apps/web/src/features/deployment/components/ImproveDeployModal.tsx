import { useCallback, useState } from "react";
import type { RerunOptions } from "@infraforge/contracts/reports";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import { Modal } from "../../../components/UI/Modal";
import { previewCanvasRerun } from "../../../api/reports.api";
import { useReportRequest } from "../../reports/useReportRequest";
import { StartingInputs } from "../../reports/components/StartingInputs";
import { SourceInputFacts } from "../../reports/components/SourceInputFacts";
import { INPUT_CLASS, AMBER_BUTTON_CLASS } from "../../../theme/controlClasses";
import { validateInfrastructureName, INFRASTRUCTURE_NAME_MAX_LENGTH } from "@infraforge/domain/validation";
import type { CanvasRerunRequest } from "../../canvas/improvement";

export function CanvasMatchPreview({ options }: { options: RerunOptions }) {
  return <div className="space-y-3 text-sm">
    <p className="font-medium">Match {options.source.infrastructureName}</p>
    <p>Source workload and seed are fixed for this rerun. Original run actions are NOT replayed.</p>
    <SourceInputFacts workload={options.workload} seed={options.seed} />
    <p>This previews the current canvas, including unsaved edits. Deploy saves this canvas to the original design first, then captures the new run. A changed preview is refused; refresh before trying again.</p>
    {!options.currentDesign.available && <p>{options.currentDesign.reason}</p>}
    {options.currentDesign.preview && <details open><summary>Current canvas diff / comparison preview</summary><StartingInputs starting={options.currentDesign.preview} detailed /></details>}
    {options.currentDesign.available && !options.currentDesign.modelCatalogCompatible && <p>Model/catalog provenance differs or is missing. The resulting comparison is descriptive only.</p>}
  </div>;
}
function Form({ options, initialName, loading, refresh, onDeploy }: { options: RerunOptions; initialName: string; loading: boolean; refresh: () => void; onDeploy: (name: string, matchedStop: boolean, hash: string) => void }) {
  const [name, setName] = useState(initialName), [matched, setMatched] = useState(options.matchedStop.defaultEnabled);
  const [error, setError] = useState<string | null>(null);
  return <form className="space-y-4" onSubmit={(e) => {
    e.preventDefault();
    const invalid = validateInfrastructureName(name);
    if (invalid) { setError(invalid); return; }
    if (!loading && options.currentDesign.available && options.currentDesign.inputHash) onDeploy(name.trim(), matched, options.currentDesign.inputHash);
  }}>
    <fieldset disabled={loading} className="space-y-4">
      <label className="block text-sm">Deployment name<input autoFocus className={INPUT_CLASS} value={name} maxLength={INFRASTRUCTURE_NAME_MAX_LENGTH} onChange={(e) => setName(e.target.value)} /></label>
      <CanvasMatchPreview options={options} />
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={matched} disabled={!options.matchedStop.available} onChange={(e) => setMatched(e.target.checked)} />Stop automatically at the same simulated time as this run.{options.matchedStop.target !== null && ` (${options.matchedStop.target} s)`}</label>
      {options.matchedStop.reason && <p className="text-sm">{options.matchedStop.reason}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-4 justify-end"><button type="button" onClick={refresh}>Refresh preview</button><button className={AMBER_BUTTON_CLASS} disabled={!options.currentDesign.available || !options.currentDesign.inputHash}>{loading ? "Saving and creating…" : "Save canvas and run again"}</button></div>
    </fieldset>
  </form>;
}
export function ImproveDeployModal({ sourceId, designId, layout, initialName, loading, onClose, onDeploy }: {
  sourceId: string; designId: string; layout: RunTopology; initialName: string; loading: boolean; onClose: () => void; onDeploy: (name: string, request: CanvasRerunRequest) => void;
}) {
  const load = useCallback(() => previewCanvasRerun(sourceId, layout), [sourceId, layout]);
  const { data, loading: previewing, error, retry } = useReportRequest(load);
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Improve → Run again" description="Preview the canvas that will be saved and deployed." loading={loading} width="560px">
    {previewing && <p role="status">Previewing current canvas…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={retry}>Try again</button></div>}
    {data && !previewing && (data.source.infrastructureId !== designId ? <p role="alert">This canvas is no longer the source's design. Clear the source context to deploy normally.</p> :
      <Form options={data} initialName={initialName} loading={loading} refresh={retry} onDeploy={(name, matchedStop, inputHash) => onDeploy(name, { sourceId, designId, layout, matchedStop, inputHash })} />)}
  </Modal>;
}
