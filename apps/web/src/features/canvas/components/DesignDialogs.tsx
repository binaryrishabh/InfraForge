import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { errorMessage } from "@/api/errorMessage";
import { ConfirmDialog, NameDialog, TypeToConfirmDialog } from "@/ui/ConfirmDialogs";
import { DeployDialog } from "@/features/deployment/components/DeployDialog";
import { ImproveDialog } from "@/features/deployment/components/ImproveDialog";
import { useCanvasStore } from "../store/canvasStore";
import { readImprovementContext } from "../improvement";
import { clearDesign, deleteDesign, renameDesign, runDesign, saveAsNew } from "../designActions";

/* Every designer dialog, driven by canvasStore.modalState so toolbar buttons and
keyboard shortcuts open the same flows. The challenge attempt dialog lives with
the brief because it needs the server's readiness check. */
export function DesignDialogs() {
  const location = useLocation();
  const modal = useCanvasStore((s) => s.modalState);
  const busy = useCanvasStore((s) => s.modalLoading);
  const name = useCanvasStore((s) => s.currentLayoutName);
  const layoutId = useCanvasStore((s) => s.currentLayoutId);
  const activeRun = useCanvasStore((s) => s.activeDeploymentId);
  const resources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const layout = useMemo(() => ({ resources, connectionLines }), [resources, connectionLines]);
  const improvement = !activeRun ? readImprovementContext(location.state, layoutId) : null;
  const store = useCanvasStore.getState;
  const close = (open: boolean) => { if (!open && !store().modalLoading) store().setModalState(null); };
  const run = async (work: () => Promise<unknown>, success: string | null, failure: string) => {
    store().setModalLoading(true);
    try { await work(); store().setModalState(null); if (success) toast.success(success); }
    catch (error) { toast.error(errorMessage(error, failure)); }
    finally { store().setModalLoading(false); }
  };
  if (!modal) return null;
  switch (modal.type) {
    case "save":
      return <NameDialog open onOpenChange={close} title={layoutId ? "Save as a new design" : "Save design"} description="Saved designs appear in Designs and can be run any number of times."
        initialValue={layoutId && name ? `${name} copy`.slice(0, 30) : ""} submitLabel="Save" loading={busy} onSubmit={(value) => void run(() => saveAsNew(value), "Design saved", "The design could not be saved.")} />;
    case "rename":
      return <NameDialog open onOpenChange={close} title="Rename design" initialValue={name ?? ""} submitLabel="Rename" loading={busy}
        onSubmit={(value) => void run(() => renameDesign(value), "Design renamed", "The design could not be renamed.")} />;
    case "confirm-new":
      return <ConfirmDialog open onOpenChange={close} title={modal.title} description={modal.description} consequences={modal.warnings} confirmLabel={modal.confirmLabel} danger
        onConfirm={() => { store().setModalState(null); clearDesign(); }} />;
    case "delete":
      return <TypeToConfirmDialog open onOpenChange={close} name={name ?? ""} loading={busy}
        onConfirm={() => void run(deleteDesign, "Design deleted", "The design could not be deleted. Stop any active run that uses it first.")} />;
    case "confirm-deploy":
      return improvement
        ? <ImproveDialog sourceId={improvement.sourceRunId} designId={improvement.designId} layout={layout} initialName={name ?? ""} loading={busy}
            onClose={() => close(false)} onRun={(runName, request) => void run(() => runDesign(undefined, runName, request), "Run started", "The run was not created. The canvas may have been saved; refresh the preview and try again.")} />
        : <DeployDialog open onOpenChange={close} initialName={name ?? ""} resourceCount={resources.length} connectionCount={connectionLines.length} loading={busy}
            onRun={(profile, runName) => void run(() => runDesign(profile, runName), "Run started", "The run could not be started.")} />;
    default:
      return null;
  }
}
