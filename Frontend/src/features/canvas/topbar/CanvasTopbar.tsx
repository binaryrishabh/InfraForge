import { memo } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { useInfrastructureDropdown } from "../hooks/useInfrastructureDropdown";
import { useInfrastructureActions } from "../hooks/useInfrastructureActions";
import { InfrastructureLayoutDropdown } from "./InfrastructureLayoutDropdown";
import { TopbarActionButton } from "./TopbarActionButton";

export const CanvasTopbar = memo(function CanvasTopbar() {
  const currentLayoutId = useCanvasStore((s) => s.currentLayoutId);
  const currentLayoutName = useCanvasStore((s) => s.currentLayoutName);
  const currentLayoutSaved = useCanvasStore((s) => s.currentLayoutSaved);
  const showLayoutDropdown = useCanvasStore((s) => s.showLayoutDropdown);
  const savedLayouts = useCanvasStore((s) => s.savedLayouts);
  
  const { handleOpenCloseDropDownNameClick, handleSelectLayout } =
    useInfrastructureDropdown();
  const { handleNew, handleSave, handleUpdate, handleDeploy, handleDelete } =
    useInfrastructureActions();

  return (
    <div className="h-12 bg-[#12161F] border-b border-[#1F2633] flex items-center justify-between px-4 shrink-0">
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
        <TopbarActionButton
          label="New"
          variant="new"
          onclick={handleNew}
        />
        {currentLayoutId ? (
          <TopbarActionButton
            label="Update"
            variant="update"
            onclick={currentLayoutSaved ? undefined : handleUpdate}
          />
        ) : (
          <TopbarActionButton
            label="Save"
            variant="save"
            onclick={handleSave}
          />
        )}
        {currentLayoutId && (
          <TopbarActionButton
            label="Deploy"
            variant="deploy"
            onclick={handleDeploy}
          />
        )}
        <TopbarActionButton
          label="Delete"
          variant="delete"
          onclick={handleDelete}
        />
      </div>
    </div>
  );
});