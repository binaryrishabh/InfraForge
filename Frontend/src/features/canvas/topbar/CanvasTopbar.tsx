import { memo } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { useInfrastructureDropdown } from "../hooks/useInfrastructureDropdown";
import { useInfrastructureActions } from "../hooks/useInfrastructureActions";
import { useCanvasConnectionActions } from "../hooks/useCanvasConnectionActions";
import { fitCanvasView } from "../hooks/useCanvasViewport";
import { InfrastructureLayoutDropdown } from "./InfrastructureLayoutDropdown";
import { TopbarActionButton } from "./TopbarActionButton";

export const CanvasTopbar = memo(function CanvasTopbar() {
  const currentLayoutId = useCanvasStore((s) => s.currentLayoutId);
  const currentLayoutName = useCanvasStore((s) => s.currentLayoutName);
  const currentLayoutSaved = useCanvasStore((s) => s.currentLayoutSaved);
  const showLayoutDropdown = useCanvasStore((s) => s.showLayoutDropdown);
  const savedLayouts = useCanvasStore((s) => s.savedLayouts);
  const isConnecting = useCanvasStore((s) => s.isConnecting);

  const { handleOpenCloseDropDownNameClick, handleSelectLayout } = useInfrastructureDropdown();
  const { handleNew, handleSave, handleUpdate, handleDeploy, handleDelete } = useInfrastructureActions();
  const { handleToggleConnectionLines } = useCanvasConnectionActions();

  return (
    <div className="h-12 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
      <span className="text-sm font-semibold tracking-wide text-gray-200 select-none">
        ⚡ InfraForge
        <InfrastructureLayoutDropdown
          currentLayoutId={currentLayoutId}
          currentLayoutName={currentLayoutName}
          showLayoutDropdown={showLayoutDropdown}
          savedLayouts={savedLayouts}
          handleOpenCloseDropDownNameClick={handleOpenCloseDropDownNameClick}
          handleSelectLayout={handleSelectLayout}
        />
      </span>
      <div className="flex items-center gap-2">
        <TopbarActionButton icon="" label="New" variant="new" onclick={handleNew} />
        {currentLayoutId ? (
          <TopbarActionButton icon="" label="Update" variant="update" onclick={currentLayoutSaved ? undefined : handleUpdate} />
        ) : (
          <TopbarActionButton icon="" label="Save" variant="save" onclick={handleSave} />
        )}
        {currentLayoutId && <TopbarActionButton icon="" label="deploy" variant="deploy" onclick={handleDeploy} />}
        <TopbarActionButton icon="" label="Delete Infrastructure" variant="delete" onclick={handleDelete} />
        <TopbarActionButton icon="" label="Fit" variant="default" onclick={() => fitCanvasView()} />
        <TopbarActionButton icon="" label={isConnecting ? "Connecting..." : "Connect"} variant={isConnecting ? "deploy" : "default"} onclick={handleToggleConnectionLines} />
      </div>
    </div>
  );
});