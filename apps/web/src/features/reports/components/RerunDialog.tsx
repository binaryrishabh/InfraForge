import { useCallback, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { RerunMode, RerunOptions } from "@infraforge/contracts/reports";
import { Modal } from "../../../components/UI/Modal";
import { getRerunOptions, createRerun } from "../../../api/reports.api";
import { useReportRequest } from "../useReportRequest";
import { StartingInputs } from "./StartingInputs";
import { useCanvasStore } from "../../canvas/store/canvasStore";
import { AMBER_BUTTON_CLASS } from "../../../theme/controlClasses";
import { useAuthStore } from "../../auth/store/auth.store";
import { SourceInputFacts } from "./SourceInputFacts";

export function RerunChoices({ options, mode, onMode, matched, onMatched }: {
  options: RerunOptions; mode: RerunMode; onMode: (mode: RerunMode) => void; matched: boolean; onMatched: (value: boolean) => void;
}) {
  return <div className="space-y-4 text-sm break-words">
    <label className="block"><input type="radio" name="rerun-mode" checked={mode === "exact"} onChange={() => onMode("exact")} disabled={!options.exact.available} /> Exact rerun</label>
    <p>Same captured starting design, same workload, same seed, same simulator/catalog. Original run actions are NOT replayed.</p>
    {options.exact.reason && <p>{options.exact.reason}</p>}
    <label className="block"><input type="radio" name="rerun-mode" checked={mode === "current-design"} onChange={() => onMode("current-design")} disabled={!options.currentDesign.available} /> Rerun with current design</label>
    <p>Current saved design, source workload and source seed. Original run actions are NOT replayed.</p>
    {options.currentDesign.reason && <p>{options.currentDesign.reason}</p>}
    {mode === "current-design" && options.currentDesign.preview && <details><summary className="cursor-pointer text-[#4FA89B]">What changed / comparison preview</summary><div className="mt-3"><StartingInputs starting={options.currentDesign.preview} detailed /></div></details>}
    {mode === "current-design" && options.currentDesign.available && !options.currentDesign.modelCatalogCompatible && <p>Model/catalog provenance differs or is missing. The resulting comparison is descriptive only.</p>}
    <SourceInputFacts workload={options.workload} seed={options.seed} />
    <label className="flex gap-2 items-start"><input type="checkbox" checked={matched} disabled={!options.matchedStop.available} onChange={(e) => onMatched(e.target.checked)} />Stop automatically at the same simulated time as this run.{options.matchedStop.target !== null && ` (${options.matchedStop.target} s)`}</label>
    {options.matchedStop.reason && <p>{options.matchedStop.reason}</p>}
  </div>;
}
function Form({ id, options, close, onBusy }: { id: string; options: RerunOptions; close: () => void; onBusy: (value: boolean) => void }) {
  const [mode, setMode] = useState<RerunMode>(options.exact.available ? "exact" : "current-design");
  const [matched, setMatched] = useState(options.matchedStop.defaultEnabled);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <form onSubmit={async (e) => {
    e.preventDefault(); if (busy) return; setBusy(true); onBusy(true); setError(null);
    const owner = useAuthStore.getState().user?.id;
    try {
      const run = await createRerun(id, mode, matched, mode === "current-design" ? options.currentDesign.inputHash ?? undefined : undefined);
      if (!mounted.current || !owner || useAuthStore.getState().user?.id !== owner) return;
      if (!run.liveTopology) throw new Error("No captured topology");
      const store = useCanvasStore.getState();
      store.loadRunTopology(run.id, run.liveTopology, run.topologyRevision, run.infrastructureId, run.runName);
      store.setIsDeploying(true);
      navigate("/design"); close();
    } catch { setError("Run creation failed. The source/design may have changed or your session ended. Close and reopen to refresh the preview."); }
    finally { if (mounted.current) { setBusy(false); onBusy(false); } }
  }}>
    <fieldset disabled={busy}><RerunChoices options={options} mode={mode} onMode={setMode} matched={matched} onMatched={setMatched} /></fieldset>
    {error && <p role="alert" className="mt-3">{error}</p>}
    <div className="flex flex-wrap gap-3 justify-end mt-5"><button type="button" disabled={busy} onClick={close}>Cancel</button>
      <button className={AMBER_BUTTON_CLASS} disabled={busy || !(mode === "exact" ? options.exact.available : options.currentDesign.available)}>{busy ? "Creating…" : "Run again"}</button></div>
  </form>;
}
function Request({ id, close, onBusy }: { id: string; close: () => void; onBusy: (value: boolean) => void }) {
  const load = useCallback(() => getRerunOptions(id), [id]);
  const { data, loading, error, retry } = useReportRequest(load);
  if (loading) return <p role="status">Loading captured inputs and options…</p>;
  if (error || !data) return <div role="alert"><p>{error}</p><button onClick={retry}>Try again</button></div>;
  return <Form id={id} options={data} close={close} onBusy={onBusy} />;
}
export function RerunDialog({ id, eligible }: { id: string; eligible: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <><button className={AMBER_BUTTON_CLASS} disabled={!eligible} onClick={() => setOpen(true)}>Run again…</button>
    <Modal open={open} onOpenChange={setOpen} loading={busy} title="Run again" description="Start a new run from captured inputs or your current saved design." width="560px">{open && <Request id={id} close={() => setOpen(false)} onBusy={setBusy} />}</Modal></>;
}
