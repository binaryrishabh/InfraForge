import { useState } from "react";
import { Link } from "react-router-dom";
import { Square, Lock, Pause } from "lucide-react";
import { toast } from "sonner";
import type { Deployment } from "@infraforge/contracts/deployment";
import { setDeploymentSpeed } from "@/api/deployment.api";
import { errorMessage } from "@/api/errorMessage";
import { formatClock, formatUsd } from "@/lib/format";
import { BrandMark } from "@/ui/Brand";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { StatusMark } from "@/ui/StatusMark";
import { Tag } from "@/ui/Tag";
import { ConfirmDialog } from "@/ui/ConfirmDialogs";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { PHASE, stopTarget, type RunPhase } from "./runState";

const SPEEDS = [0, 1, 10, 60] as const;

function SpeedControl({ deploymentId, enabled }: { deploymentId: string; enabled: boolean }) {
  const speed = useSimulationStore((s) => s.speed);
  const [busy, setBusy] = useState(false);
  const change = async (value: number) => {
    if (value === speed) return;
    setBusy(true);
    const rollback = useSimulationStore.getState().setSpeed(value);
    try { await setDeploymentSpeed(deploymentId, value); }
    catch (error) { rollback(); toast.error(errorMessage(error, "The speed could not be changed.")); }
    finally { setBusy(false); }
  };
  return (
    <Segmented label="Simulation speed" size="sm" value={SPEEDS.includes(speed as never) ? speed : 1} onChange={(v) => void change(v)} disabled={!enabled || busy}
      options={SPEEDS.map((v) => ({ value: v, title: v === 0 ? "Pause" : `${v} simulated seconds per second`,
        label: v === 0 ? <><Pause size={12} aria-hidden="true" /><span className="sr-only">Pause</span></> : `${v}×` }))} />
  );
}

/* The instrument strip: identity, state, simulated clock, the automatic stop,
pace, cost so far and the stop control. */
export function RunBar({ run, deploymentId, phase, challengeTitle, onStop, stopping }: {
  run: Deployment | null; deploymentId: string; phase: RunPhase; challengeTitle: string | null; onStop: () => Promise<boolean>; stopping: boolean;
}) {
  const seconds = useSimulationStore((s) => s.simulatedSeconds);
  const speed = useSimulationStore((s) => s.speed);
  const burn = useSimulationStore((s) => s.burnRatePerHourUsd);
  const spent = useSimulationStore((s) => s.accumulatedCostUsd);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const target = stopTarget(run);
  const live = phase === "live";
  return (
    <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2 sm:flex-nowrap">
      <Link to="/home" aria-label="InfraForge home (the run keeps going)" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-sunken"><BrandMark size={20} /></Link>
      <div className="min-w-0 flex-1 sm:flex-none">
        <p className="truncate text-[15px] font-semibold leading-tight text-ink">{run?.runName ?? "Run"}</p>
        <p className="flex items-center gap-2 text-[11.5px] leading-tight text-ink-3">
          <StatusMark size="sm" kind={PHASE[phase].kind} label={PHASE[phase].label} />
          {run?.challengeId ? <span>Challenge attempt</span> : run?.rerunMode ? <span>{run.rerunMode === "exact" ? "Exact rerun" : "Rerun, current design"}</span> : <span>Freeform run</span>}
        </p>
      </div>
      {challengeTitle && <Tag tone="neutral" className="max-lg:hidden" icon={<Lock size={11} aria-hidden="true" />}><span className="max-w-[22ch] truncate">{challengeTitle}</span></Tag>}
      <dl className="order-last flex w-full items-center gap-4 sm:order-none sm:ml-auto sm:w-auto">
        <div><dt className="if-eyebrow !text-[10px]">Simulated</dt><dd className="if-num text-[17px] leading-tight text-ink">{formatClock(seconds)}{speed === 0 && live && <span className="ml-1.5 text-xs text-warn">paused</span>}</dd></div>
        {target && <div><dt className="if-eyebrow !text-[10px]">{target.reason === "evaluation" ? "Evaluation" : "Matched stop"}</dt>
          <dd className="if-num text-[13px] leading-tight text-ink-2">{formatClock(target.seconds)} <span className="text-ink-3">· {Math.max(0, target.seconds - seconds)} s left</span></dd></div>}
        <div className="hidden md:block"><dt className="if-eyebrow !text-[10px]">Model cost</dt>
          <dd className="if-num text-[13px] leading-tight text-ink-2">{formatUsd(spent, 3)} <span className="text-ink-3">· {formatUsd(burn)}/h</span></dd></div>
      </dl>
      <div className="flex shrink-0 items-center gap-2">
        {phase !== "finished" && phase !== "failed" && <SpeedControl deploymentId={deploymentId} enabled={live} />}
        {(live || phase === "stopping") && (
          <Button variant="danger" size="sm" icon={<Square size={12} aria-hidden="true" />} disabled={stopping} onClick={() => setConfirm(true)}>
            {stopping ? "Stopping…" : "Stop"}
          </Button>
        )}
        {phase === "live" && speed === 0 && <span className="sr-only" role="status">Simulation paused</span>}
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} danger loading={busy} title="Stop this run?" confirmLabel="Stop run"
        description="The simulator captures the exact final state and the run ends. It cannot be resumed."
        consequences={target?.reason === "evaluation" && seconds < target.seconds
          ? [`This attempt has not reached second ${target.seconds}, so the requirements that are measured then will not be evaluated.`, "Your prediction stays recorded."]
          : ["The canvas and the run's recorded evidence remain available in its report."]}
        onConfirm={async () => { setBusy(true); const ok = await onStop(); setBusy(false); if (ok) setConfirm(false); }} />
    </header>
  );
}
