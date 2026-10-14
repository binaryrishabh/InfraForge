import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PenTool } from "lucide-react";
import { getSpecificInfrastructure } from "@/api/infrastructure.api";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialogs";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";
import { installImprovementDesign } from "@/features/canvas/improvement";

/* Opens the run's saved design with the run as improvement context, so the
next run reuses its workload and seed and can be compared with it. */
export function OpenDesignToImprove({ sourceId, designId, eligible }: { sourceId: string; designId: string | null; eligible: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const open = async () => {
    if (!designId || busy) return;
    setBusy(true); setError(null);
    const owner = useAuthStore.getState().user?.id;
    try {
      const design = await getSpecificInfrastructure(designId);
      if (!owner || useAuthStore.getState().user?.id !== owner) return;
      installImprovementDesign(design);
      navigate("/design", { state: { improveRun: { sourceRunId: sourceId, designId } } });
    } catch { setError("The original design is unavailable or your session ended."); }
    finally { setBusy(false); setConfirm(false); }
  };
  return (
    <>
      <Button variant="secondary" size="sm" disabled={!designId || !eligible || busy} loading={busy} icon={<PenTool size={14} aria-hidden="true" />} onClick={() => {
        const canvas = useCanvasStore.getState();
        if (canvas.activeDeploymentId || (!canvas.currentLayoutSaved && canvas.resources.length)) setConfirm(true);
        else void open();
      }}>Open design to improve</Button>
      {!designId && <p className="w-full text-xs text-ink-3">Editable design deleted; an exact rerun remains available when its inputs are supported.</p>}
      {error && <p role="alert" className="w-full text-sm text-fail">{error}</p>}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} loading={busy} title="Open the saved design?" confirmLabel="Open saved design"
        description="This replaces the current canvas." consequences={["Unsaved canvas edits are lost.", "Runs already on the server continue; reopen them from Home or Runs."]}
        onConfirm={() => void open()} />
    </>
  );
}
