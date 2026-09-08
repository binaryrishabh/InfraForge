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
    // Floating bar: centered, exactly 50% of the window width.
    // min-w guard keeps the button cluster usable on narrow windows;
    // max-w keeps side gaps if the viewport is ever tiny.
    <div className="absolute top-3 left-1/2 -translate-x-1/2 w-1/2 min-w-140 max-w-[calc(100vw-1.5rem)] z-40 pointer-events-none">
      <div className="pointer-events-auto h-12 rounded-xl border border-[#273042] bg-[#12161F]/95 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,0.45)] flex items-center justify-between gap-2 px-3 select-none">
        {/* Logo + infrastructure selector */}
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="/favicon.png"
            alt="InfraForge"
            className="h-6 w-6 shrink-0"
            draggable={false}
          />
          <span className="w-px h-5 bg-[#273042] shrink-0" />
          <InfrastructureLayoutDropdown
            currentLayoutId={currentLayoutId}
            currentLayoutName={currentLayoutName}
            showLayoutDropdown={showLayoutDropdown}
            savedLayouts={savedLayouts}
            handleOpenCloseDropDownNameClick={handleOpenCloseDropDownNameClick}
            handleSelectLayout={handleSelectLayout}
          />
        </div>
        {/* Action buttons — unchanged */}
        <div className="flex items-center gap-1.5 shrink-0">
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
    </div>
  );
});