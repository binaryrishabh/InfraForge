import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSpecificInfrastructure } from "../../../api/infrastructure.api";
import { Modal } from "../../../components/UI/Modal";
import { useAuthStore } from "../../auth/store/auth.store";
import { useCanvasStore } from "../../canvas/store/canvasStore";
import { installImprovementDesign } from "../../canvas/improvement";

export function OpenDesignToImprove({ sourceId, designId, eligible }: { sourceId: string; designId: string | null; eligible: boolean }) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
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
  return <><button className="text-[#4FA89B] underline disabled:opacity-50" disabled={!designId || !eligible || busy} onClick={() => {
    const canvas = useCanvasStore.getState();
    if (canvas.activeDeploymentId || (!canvas.currentLayoutSaved && canvas.resources.length)) setConfirm(true);
    else void open();
  }}>{busy ? "Opening design…" : "Open design to improve"}</button>
    {!designId && <p className="text-sm text-[#8B909C]">Editable design deleted; exact rerun remains available when its inputs are supported.</p>}
    {error && <p role="alert">{error}</p>}
    <Modal open={confirm} onOpenChange={setConfirm} loading={busy} title="Open the saved design?" description="This replaces the current local canvas, including unsaved edits. Existing server runs continue; reattach through the dashboard.">
      <div className="flex gap-4 justify-end"><button disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button disabled={busy} onClick={() => void open()}>Open saved design</button></div>
    </Modal></>;
}
