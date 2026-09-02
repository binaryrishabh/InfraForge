import { DndContext, DragOverlay } from "@dnd-kit/core";
import { toast } from "sonner";
import { CanvasBoard } from "./CanvasBoard";
import { ResourceSidebar } from "./ResourceSidebar";
import { CanvasTopbar } from "../topbar/CanvasTopbar";
import { DeploymentPipeline } from "@/features/deployment/components/DeploymentPipeline";
import { ResourceConfigPanel } from "./ResourceConfigPanel";
import { InputModal } from "@/components/UI/InputModal";
import { ConfirmModal } from "@/components/UI/ConfirmModal";
import { TypeToConfirmModal } from "@/components/UI/TypeToConfirmModal";
import { DeployModal } from "@/features/deployment/components/DeployModal";
import { Network } from "lucide-react";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { useCanvasDesignerController } from "../hooks/useCanvasDesignerController";
import { useCanvasStore } from "../store/canvasStore";

export function CanvasDesignerPage() {
  // Canvas state — read straight from the single source of truth
  const canvasResources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const isConnecting = useCanvasStore((s) => s.isConnecting);
  const selectedResourceForConfig = useCanvasStore((s) => s.selectedResourceForConfigId);
  const emptyCanvasStateDismissed = useCanvasStore((s) => s.emptyCanvasStateDismissed);
  const currentLayoutId = useCanvasStore((s) => s.currentLayoutId);

  const {
    // Layout metadata
    currentLayoutName,
    currentLayoutSaved,
    // Deployment
    activeDeploymentId,
    setActiveDeploymentId,
    // isDeploying,
    setIsDeploying,
    // Config panel + empty state
    setSelectedResourceForConfig,
    setEmptyCanvasStateDismissed,
    // Persistence
    isInitialized,
    // Dropdown
    showLayoutDropdown,
    savedLayouts,
    handleOpenCloseDropDownNameClick,
    handleSelectLayout,
    // Connections
    hanldeResouceClick,
    handleToggleConnectionLines,
    // Resource actions
    handleDeleteCanvasResource,
    handleUpdateCanvasResource,
    // Infrastructure actions
    modalState,
    setModalState,
    modalLoading,
    setModalLoading,
    handleNew,
    handleSave,
    handleUpdate,
    handleDelete,
    handleDeploy,
    handleNewExecute,
    handleSaveWithName,
    handleUpdateWithName,
    handleDeleteExecute,
    handleDeployExecute,
    loadSampleArchitecture,
    // Drag & Drop
    sensors,
    activeDrag,
    onDragStart,
    onDragEnd,
    // Config panel
    handleResourceDoubleClickShowConfig,
  } = useCanvasDesignerController();

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <DragOverlay>
        {activeDrag && (
          <div className="w-12 h-12 rounded-lg bg-[#12162F] border border-[#35415A] flex items-center justify-center shadow-xl opacity-90">
            <ResourceIcon
              type={activeDrag.label}
              size={24}
              className="text-blue-400"
            />
          </div>
        )}
      </DragOverlay>
      <div className="flex flex-col h-screen bg-[#0f1117] text-white">
        <CanvasTopbar
          showLayoutDropdown={showLayoutDropdown}
          savedLayouts={savedLayouts}
          handleOpenCloseDropDownNameClick={handleOpenCloseDropDownNameClick}
          handleSelectLayout={handleSelectLayout}
          currentLayoutId={currentLayoutId}
          currentLayoutName={currentLayoutName}
          currentLayoutSaved={currentLayoutSaved}
          handleNew={handleNew}
          handleSave={handleSave}
          handleUpdate={handleUpdate}
          handleDeploy={handleDeploy}
          handleDelete={handleDelete}
          isConnecting={isConnecting}
          handleToggleConnectionLines={handleToggleConnectionLines}
        />
        <div className="flex flex-1 overflow-hidden">
          <ResourceSidebar />
          {canvasResources.length === 0 &&
          !emptyCanvasStateDismissed &&
          (!currentLayoutId || !isInitialized) ? (
            /* Empty state overlay */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#12161F] border border-[#273042] flex items-center justify-center">
                  <Network className="w-8 h-8 text-gray-600" />
                </div>
                <h2 className="text-lg font-semibold text-[#EDF1F7] mb-1">
                  Design your infrastructure
                </h2>
                <p className="text-sm text-[#677185] mb-6 max-w-sm">
                  Drag resources from the sidebar, connect them, and deploy a
                  simulated cloud architecture.
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={loadSampleArchitecture}
                    className="px-4 py-2 rounded-lg bg-[#5B8CFF] text-sm font-medium text-[#081018] hover:bg-[#7AA2FF] transition-colors duration-150"
                  >
                    Load sample architecture
                  </button>
                  <button
                    onClick={() => setEmptyCanvasStateDismissed(true)}
                    className="px-4 py-2 rounded-lg bg-[#1D2432] border border-[#273042] text-sm font-medium text-[#AAB4C5] hover:bg-[#232B3B] transition-colors duration-150"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <CanvasBoard
              resources={canvasResources}
              onDeleteResource={handleDeleteCanvasResource}
              onResourceClick={hanldeResouceClick}
              connectionLines={connectionLines}
              onResourceDoubleClick={handleResourceDoubleClickShowConfig}
            />
          )}
        </div>
      </div>
      {selectedResourceForConfig && (
        <ResourceConfigPanel
          resource={canvasResources.find(
            (r) => r.id === selectedResourceForConfig,
          )}
          onClose={() => setSelectedResourceForConfig(null)}
          onUpdateResource={handleUpdateCanvasResource}
        />
      )}
      {activeDeploymentId && (
        <DeploymentPipeline
          deploymentId={activeDeploymentId}
          onDeploymentPreviewClose={() => {
            setActiveDeploymentId(null);
            setIsDeploying(false);
          }}
          onDeploymentComplete={() => setIsDeploying(false)}
          onDeploymentFailed={() => setIsDeploying(false)}
        />
      )}
      {/* -------------MODAL SYSTEM Conditionally Rendered----------------*/}
      {/* 1. SAVE MODAL */}
      {modalState?.type === "save" && (
        <InputModal
          open={true}
          onOpenChange={(open) => {
            if (!open && !modalLoading) setModalState(null);
          }}
          title="Save infrastructure"
          description="Save the current canvas layout to your infrastructure list."
          submitLabel="Save"
          loading={modalLoading}
          onSubmit={async (name) => {
            setModalLoading(true);
            try {
              await handleSaveWithName(name);
              setModalState(null);
              toast.success("Infrastructure saved");
            } catch {
              toast.error("Failed to save infrastructure");
            } finally {
              setModalLoading(false);
            }
          }}
        />
      )}
      {/* 2. UPDATE MODAL */}
      {modalState?.type === "update" && (
        <InputModal
          open={true}
          onOpenChange={(open) => {
            if (!open && !modalLoading) setModalState(null);
          }}
          title="Update infrastructure"
          description="Update the saved layout with the current canvas state."
          initialValue={currentLayoutName || ""}
          submitLabel="Update"
          loading={modalLoading}
          onSubmit={async (name) => {
            setModalLoading(true);
            try {
              await handleUpdateWithName(name);
              setModalState(null);
              toast.success("Infrastructure updated");
            } catch {
              toast.error("Failed to update infrastructure");
            } finally {
              setModalLoading(false);
            }
          }}
        />
      )}
      {/* 3. CONFIRM NEW MODAL */}
      {modalState?.type === "confirm-new" && (
        <ConfirmModal
          open={true}
          onOpenChange={(open) => {
            if (!open && !modalLoading) setModalState(null);
          }}
          title={modalState.title}
          description={modalState.description}
          consequences={modalState.warnings}
          confirmLabel={modalState.confirmLabel}
          intent="danger"
          loading={modalLoading}
          onConfirm={() => {
            setModalState(null);
            handleNewExecute();
            toast.success("Canvas cleared");
          }}
        />
      )}
      {/* 4. CONFIRM DEPLOY MODAL */}
      {modalState?.type === "confirm-deploy" && (
        <DeployModal
          open={true}
          onOpenChange={(open) => {
            if (!open && !modalLoading) setModalState(null);
          }}
          resourceCount={canvasResources.length}
          connectionCount={connectionLines.length}
          loading={modalLoading}
          onDeploy={async (profile) => {
            setModalLoading(true);
            try {
              await handleDeployExecute(profile);
              setModalState(null);
            } catch {
              toast.error("Failed to start deployment");
            } finally {
              setModalLoading(false);
            }
          }}
        />
      )}
      {/* 5. DELETE MODAL */}
      {modalState?.type === "delete" && (
        <TypeToConfirmModal
          open={true}
          onOpenChange={(open) => {
            if (!open && !modalLoading) setModalState(null);
          }}
          infrastructureName={currentLayoutName || ""}
          loading={modalLoading}
          onConfirm={async () => {
            setModalLoading(true);
            try {
              await handleDeleteExecute();
              setModalState(null);
              toast.success("Infrastructure deleted");
            } catch {
              toast.error("Failed to delete infrastructure");
            } finally {
              setModalLoading(false);
            }
          }}
        />
      )}
    </DndContext>
  );
}