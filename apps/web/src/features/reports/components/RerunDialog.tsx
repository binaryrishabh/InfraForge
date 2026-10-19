import { useCapabilityAvailability } from "@/api/capabilities.api";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RotateCw } from "lucide-react";
import type { RerunMode, RerunOptions } from "@infraforge/contracts/reports";
import { createRerun, getRerunOptions } from "@/api/reports.api";
import { useRequest } from "@/api/useRequest";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Loading, Notice } from "@/ui/Page";
import { cx } from "@/ui/cx";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { StartingInputs } from "./StartingInputs";
import { SourceInputFacts } from "./SourceInputFacts";

function ModeCard({ checked, disabled, onChange, title, body, reason }: { checked: boolean; disabled: boolean; onChange: () => void; title: string; body: string; reason: string | null }) {
  return (
    <label className={cx("flex gap-3 rounded-md border px-3.5 py-3", disabled ? "cursor-not-allowed border-line opacity-70" : "cursor-pointer", checked ? "border-ink bg-surface" : "border-line-strong hover:border-ink-3")}>
      <input type="radio" name="rerun-mode" checked={checked} onChange={onChange} disabled={disabled} className="mt-1 accent-[var(--if-ink)]" />
      <span><span className="block text-sm font-semibold text-ink">{title}</span><span className="mt-0.5 block text-sm text-ink-2">{body}</span>
        {reason && <span className="mt-1 block text-xs text-warn">{reason}</span>}</span>
    </label>
  );
}

export function RerunChoices({ options, mode, onMode, matched, onMatched }: {
  options: RerunOptions; mode: RerunMode; onMode: (mode: RerunMode) => void; matched: boolean; onMatched: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4 break-words text-sm">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium text-ink-2">What to run</legend>
        <ModeCard checked={mode === "exact"} disabled={!options.exact.available} onChange={() => onMode("exact")} title="Exact rerun" reason={options.exact.reason}
          body="Same captured starting design, same workload, same seed, same simulator/catalog. Original run actions are NOT replayed." />
        <ModeCard checked={mode === "current-design"} disabled={!options.currentDesign.available} onChange={() => onMode("current-design")} title="Rerun with the current design" reason={options.currentDesign.reason}
          body="Your current saved design with the source workload and seed. Original run actions are NOT replayed." />
      </fieldset>
      {mode === "current-design" && options.currentDesign.preview && (
        <details className="rounded-md border border-line px-4 py-2.5"><summary className="cursor-pointer text-sm font-medium text-ink">What changed since the source run</summary>
          <div className="mt-3"><StartingInputs starting={options.currentDesign.preview} detailed /></div></details>
      )}
      {mode === "current-design" && options.currentDesign.available && !options.currentDesign.modelCatalogCompatible && <Notice tone="warn">Model or catalog provenance differs or is missing. The resulting comparison is descriptive only.</Notice>}
      <SourceInputFacts workload={options.workload} seed={options.seed} />
      <label className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-ink">
        <input type="checkbox" className="mt-0.5 accent-[var(--if-ink)]" checked={matched} disabled={!options.matchedStop.available} onChange={(e) => onMatched(e.target.checked)} />
        <span>Stop automatically at the same simulated time as this run{options.matchedStop.target !== null && <span className="if-num"> ({options.matchedStop.target} s)</span>}.
          {options.matchedStop.reason && <span className="mt-0.5 block text-xs text-ink-3">{options.matchedStop.reason}</span>}</span>
      </label>
    </div>
  );
}

function Form({ id, options, close, onBusy }: { id: string; options: RerunOptions; close: () => void; onBusy: (value: boolean) => void }) {
  const availability = useCapabilityAvailability();
  const [mode, setMode] = useState<RerunMode>(options.exact.available ? "exact" : "current-design");
  const [matched, setMatched] = useState(options.matchedStop.defaultEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const available = mode === "exact" ? options.exact.available : options.currentDesign.available;
  return (
    <form onSubmit={async (event) => {
      event.preventDefault(); if (busy) return;
      setBusy(true); onBusy(true); setError(null);
      const owner = useAuthStore.getState().user?.id;
      try {
        const run = await createRerun(id, mode, matched, mode === "current-design" ? options.currentDesign.inputHash ?? undefined : undefined);
        if (!mounted.current || !owner || useAuthStore.getState().user?.id !== owner) return;
        if (!run.liveTopology) throw new Error("No captured topology");
        const store = useCanvasStore.getState();
        store.loadRunTopology(run.id, run.liveTopology, run.topologyRevision, run.infrastructureId, run.runName);
        store.setIsDeploying(true); store.setLiveLocked(false);
        // A rerun is always a freeform run, even when its source was a challenge attempt.
        store.setCurrentChallengeId(null);
        navigate("/design"); close();
      } catch { setError("The rerun was not created. The source or design may have changed, or your session ended. Close and reopen to refresh."); }
      finally { if (mounted.current) { setBusy(false); onBusy(false); } }
    }}>
      <fieldset disabled={busy || availability?.run.allowed === false}><>{availability?.run.allowed === false && <Notice tone="warn">{availability.run.reason}</Notice>}<RerunChoices options={options} mode={mode} onMode={setMode} matched={matched} onMatched={setMatched} /></></fieldset>
      {error && <Notice tone="fail" role="alert" className="mt-4">{error}</Notice>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!available} icon={<RotateCw size={14} aria-hidden="true" />}>Run again</Button>
      </div>
    </form>
  );
}

function Request({ id, close, onBusy }: { id: string; close: () => void; onBusy: (value: boolean) => void }) {
  const load = useCallback(() => getRerunOptions(id), [id]);
  const { data, loading, error, retry } = useRequest(load, "The rerun options could not be loaded.");
  if (loading) return <Loading label="Loading captured inputs and options…" />;
  if (error || !data) return <div role="alert"><p>{error}</p><Button className="mt-2" size="sm" onClick={retry}>Try again</Button></div>;
  return <Form id={id} options={data} close={close} onBusy={onBusy} />;
}

export function RerunDialog({ id, eligible, experimentChallenge = null }: { id: string; eligible: boolean; experimentChallenge?: string | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant="primary" size="sm" disabled={!eligible} icon={<RotateCw size={14} aria-hidden="true" />} onClick={() => setOpen(true)}>Run again…</Button>
      <Dialog open={open} onOpenChange={setOpen} busy={busy} size="lg" title="Run again" description="Start a new run from this run's captured inputs or from your current saved design.">
        {open && experimentChallenge && (
          // A rerun replays captured inputs, not actions: the challenge's scheduled fault is not part of it.
          <Notice tone="info" className="mb-4" title="A rerun does not include the scheduled fault">
            A rerun is a freeform run of the captured inputs, without the challenge's experiment, and it is not judged.
            To repeat the experiment, <Link to={`/challenges/${experimentChallenge}`} className="font-medium text-accent underline-offset-4 hover:underline">start a new attempt</Link>.
          </Notice>
        )}
        {open && <Request id={id} close={() => setOpen(false)} onBusy={setBusy} />}
      </Dialog>
    </>
  );
}
