import { useEffect, useState } from "react";
import { useStopRun } from "@/features/live/useStopRun";
import { Button, ButtonLink } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialogs";
import { Notice } from "@/ui/Page";

export function LiveRunNotice({ id, onStopped }: { id: string; onStopped?: () => void }) {
  const { stop, requesting, stopping, stopped } = useStopRun(id);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (stopped) onStopped?.(); }, [stopped, onStopped]);
  return <Notice className="mt-4" tone="info">
    <p>{stopped ? "This run has stopped." : "This run is still live. The report shows retained evidence, not a live monitor."}</p>
    {!stopped && <div className="mt-3 flex flex-wrap gap-2">
      <ButtonLink to={`/design?run=${encodeURIComponent(id)}`} size="sm">Open live run</ButtonLink>
      <Button variant="danger" size="sm" disabled={requesting || stopping} onClick={() => setConfirm(true)}>{stopping ? "Stopping…" : "Stop run"}</Button>
    </div>}
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} danger loading={requesting} title="Stop this run?" confirmLabel="Stop run"
      description="The simulator captures the exact final state and the run ends. It cannot be resumed."
      consequences={["The canvas and recorded evidence remain available in the report. Stopping a challenge early can leave requirements unevaluated."]}
      onConfirm={async () => { if (await stop()) setConfirm(false); }} />
  </Notice>;
}
