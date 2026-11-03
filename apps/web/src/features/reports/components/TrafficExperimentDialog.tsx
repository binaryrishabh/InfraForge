import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import type { RerunOptions } from "@infraforge/contracts/reports";
import { useCapabilityAvailability } from "@/api/capabilities.api";
import { errorMessage } from "@/api/errorMessage";
import { createWorkloadVariantRun, getRerunOptions } from "@/api/reports.api";
import { useRequest } from "@/api/useRequest";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Loading, Notice } from "@/ui/Page";
import { cx } from "@/ui/cx";
import { enterCreatedRun } from "../enterCreatedRun";
import { SAME_SEED_NOTE, UNCHANGED, experimentSubmission, variantGroups } from "../trafficExperiment";
import { SourceInputFacts } from "./SourceInputFacts";
import { StartingInputs } from "./StartingInputs";

type Variants = RerunOptions["workloadVariant"];

/* One radio group across both dimensions: choosing a second setting replaces the first,
so the learner can only ever change one thing. */
export function TrafficChangeChoices({ options, selected, onSelect }: { options: Variants; selected: string | null; onSelect: (key: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {variantGroups(options).map(group => (
        <fieldset key={group.dimension} className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-ink-2">{group.legend} <span className="font-normal text-ink-3">· source run: {group.current}</span></legend>
          {group.choices.map(choice => {
            const disabled = !choice.available;
            return (
              <label key={choice.key} className={cx("flex gap-3 rounded-md border px-3.5 py-2.5", disabled ? "cursor-not-allowed border-line opacity-70" : "cursor-pointer", selected === choice.key ? "border-ink bg-surface" : "border-line-strong hover:border-ink-3")}>
                <input type="radio" name="traffic-change" className="mt-1 accent-[var(--if-ink)]" checked={selected === choice.key} disabled={disabled} onChange={() => onSelect(choice.key)} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{choice.label}{choice.isCurrent && <span className="ml-2 text-xs font-normal text-ink-3">current setting</span>}</span>
                  {!choice.isCurrent && choice.reason && <span className="mt-0.5 block text-xs text-warn">{choice.reason}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

export function TrafficExperimentForm({ id, options, close, onBusy }: { id: string; options: RerunOptions; close: () => void; onBusy: (value: boolean) => void }) {
  const availability = useCapabilityAvailability();
  const variants = options.workloadVariant;
  const [selected, setSelected] = useState<string | null>(null);
  const [matched, setMatched] = useState(options.matchedStop.defaultEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const blocked = availability?.run.allowed === false ? availability.run.reason : null;
  const { choice, change, ready, reason } = experimentSubmission(variants, selected, blocked);
  return (
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (busy || !choice?.inputHash) return;
      setBusy(true); onBusy(true); setError(null);
      const owner = useAuthStore.getState().user?.id;
      try {
        const run = await createWorkloadVariantRun(id, choice.variant, matched, choice.inputHash);
        if (!mounted.current || !owner || useAuthStore.getState().user?.id !== owner) return;
        enterCreatedRun(run, navigate); close();
      } catch (error) { setError(errorMessage(error, "The run was not created. The source run may have changed, or your session ended. Close and reopen to refresh.")); }
      finally { if (mounted.current) { setBusy(false); onBusy(false); } }
    }}>
      <fieldset disabled={busy} className="flex flex-col gap-4 break-words text-sm">
        {blocked && <Notice tone="warn">{blocked}</Notice>}
        <TrafficChangeChoices options={variants} selected={selected} onSelect={setSelected} />
        <div aria-live="polite" className="rounded-md border border-line px-4 py-3">
          {change ? <p className="font-medium text-ink">You will change: {change.dimension}, {change.from} to {change.to}.</p> : <p className="text-ink-3">Choose the one setting to change.</p>}
          <p className="mt-2 text-xs font-medium text-ink-2">Stays exactly the same:</p>
          <ul className="mt-1 list-disc pl-5 text-ink-2">{UNCHANGED.map(line => <li key={line}>{line}</li>)}</ul>
          {choice?.preview && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-ink">Check what differs from the source run</summary>
            <div className="mt-3"><StartingInputs starting={choice.preview} detailed /></div></details>}
        </div>
        <SourceInputFacts workload={options.workload} seed={options.seed} />
        <Notice tone="info">{SAME_SEED_NOTE}</Notice>
        <label className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-ink">
          <input type="checkbox" className="mt-0.5 accent-[var(--if-ink)]" checked={matched} disabled={!options.matchedStop.available} onChange={(e) => setMatched(e.target.checked)} />
          <span>Stop automatically at the same simulated time as the source run{options.matchedStop.target !== null && <span className="if-num"> ({options.matchedStop.target} s)</span>}, so whole-run totals can be compared.
            {options.matchedStop.reason && <span className="mt-0.5 block text-xs text-ink-3">{options.matchedStop.reason}</span>}
            {!matched && <span className="mt-0.5 block text-xs text-warn">Without a matched stop the two runs may have different durations, and the comparison will hold back whole-run deltas.</span>}</span>
        </label>
      </fieldset>
      {error && <Notice tone="fail" role="alert" className="mt-4">{error}</Notice>}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {!ready && !busy && <p id="traffic-experiment-reason" className="mr-auto text-xs text-ink-3">{reason}</p>}
        <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!ready} aria-describedby={ready ? undefined : "traffic-experiment-reason"} icon={<FlaskConical size={14} aria-hidden="true" />}>Run with this change</Button>
      </div>
    </form>
  );
}

function Request({ id, close, onBusy }: { id: string; close: () => void; onBusy: (value: boolean) => void }) {
  const load = useCallback(() => getRerunOptions(id), [id]);
  const { data, loading, error, retry } = useRequest(load, "The experiment options could not be loaded.");
  if (loading) return <Loading label="Loading the captured traffic settings…" />;
  if (error || !data) return <div role="alert"><p>{error}</p><Button className="mt-2" size="sm" onClick={retry}>Try again</Button></div>;
  if (!data.workloadVariant.available) return <Notice tone="warn" title="This run cannot be used for a traffic experiment">{data.workloadVariant.reason ?? "No supported traffic change is available."}</Notice>;
  return <TrafficExperimentForm id={id} options={data} close={close} onBusy={onBusy} />;
}

/* Starts a new official run of the same captured design and seed with exactly one traffic setting changed. */
export function TrafficExperimentDialog({ id, eligible }: { id: string; eligible: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" disabled={!eligible} icon={<FlaskConical size={14} aria-hidden="true" />} onClick={() => setOpen(true)}>Change traffic and run again…</Button>
      <Dialog open={open} onOpenChange={setOpen} busy={busy} size="lg" title="Change traffic and run again"
        description="Run this run's captured design again with exactly one traffic setting changed, then compare the two recorded runs.">
        {open && <Request id={id} close={() => setOpen(false)} onBusy={setBusy} />}
      </Dialog>
    </>
  );
}
