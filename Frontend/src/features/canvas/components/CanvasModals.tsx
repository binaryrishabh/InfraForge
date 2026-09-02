import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import { useInfrastructureActions } from "../hooks/useInfrastructureActions";
import { InputModal } from "@/components/UI/InputModal";
import { ConfirmModal } from "@/components/UI/ConfirmModal";
import { TypeToConfirmModal } from "@/components/UI/TypeToConfirmModal";
import { DeployModal } from "@/features/deployment/components/DeployModal";

export function CanvasModals() {
  const modalState = useCanvasStore((s) => s.modalState);
  const modalLoading = useCanvasStore((s) => s.modalLoading);
  const currentLayoutName = useCanvasStore((s) => s.currentLayoutName);
  const resources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  
  const setModalState = useCanvasStore((s) => s.setModalState);
  const setModalLoading = useCanvasStore((s) => s.setModalLoading);
  
  const {
    handleNewExecute, handleSaveWithName, handleUpdateWithName,
    handleDeleteExecute, handleDeployExecute
  } = useInfrastructureActions();

  if (!modalState) return null;

  return (
    <>
      {modalState.type === "save" && (
        <InputModal
          open={true}
          onOpenChange={(open) => { if (!open && !modalLoading) setModalState(null); }}
          title="Save infrastructure"
          description="Save the current canvas layout to your infrastructure list."
          submitLabel="Save"
          loading={modalLoading}
          onSubmit={async (name) => {
            setModalLoading(true);
            try { await handleSaveWithName(name); setModalState(null); toast.success("Infrastructure saved"); }
            catch { toast.error("Failed to save infrastructure"); }
            finally { setModalLoading(false); }
          }}
        />
      )}
      {modalState.type === "update" && (
        <InputModal
          open={true}
          onOpenChange={(open) => { if (!open && !modalLoading) setModalState(null); }}
          title="Update infrastructure"
          description="Update the saved layout with the current canvas state."
          initialValue={currentLayoutName || ""}
          submitLabel="Update"
          loading={modalLoading}
          onSubmit={async (name) => {
            setModalLoading(true);
            try { await handleUpdateWithName(name); setModalState(null); toast.success("Infrastructure updated"); }
            catch { toast.error("Failed to update infrastructure"); }
            finally { setModalLoading(false); }
          }}
        />
      )}
      {modalState.type === "confirm-new" && (
        <ConfirmModal
          open={true}
          onOpenChange={(open) => { if (!open && !modalLoading) setModalState(null); }}
          title={modalState.title}
          description={modalState.description}
          consequences={modalState.warnings}
          confirmLabel={modalState.confirmLabel}
          intent="danger"
          loading={modalLoading}
          onConfirm={() => { setModalState(null); handleNewExecute(); toast.success("Canvas cleared"); }}
        />
      )}
      {modalState.type === "confirm-deploy" && (
        <DeployModal
          open={true}
          onOpenChange={(open) => { if (!open && !modalLoading) setModalState(null); }}
          resourceCount={resources.length}
          connectionCount={connectionLines.length}
          loading={modalLoading}
          onDeploy={async (profile) => {
            setModalLoading(true);
            try { await handleDeployExecute(profile); setModalState(null); }
            catch { toast.error("Failed to start deployment"); }
            finally { setModalLoading(false); }
          }}
        />
      )}
      {modalState.type === "delete" && (
        <TypeToConfirmModal
          open={true}
          onOpenChange={(open) => { if (!open && !modalLoading) setModalState(null); }}
          infrastructureName={currentLayoutName || ""}
          loading={modalLoading}
          onConfirm={async () => {
            setModalLoading(true);
            try { await handleDeleteExecute(); setModalState(null); toast.success("Infrastructure deleted"); }
            catch { toast.error("Failed to delete infrastructure"); }
            finally { setModalLoading(false); }
          }}
        />
      )}
    </>
  );
}