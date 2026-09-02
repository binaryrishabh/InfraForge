import { memo } from "react";
import type { Infrastructure } from "@shared/interface/Infrastructure.interface";
import { InfrastructureLayoutDropdown } from "./InfrastructureLayoutDropdown";
import { TopbarActionButton } from "./TopbarActionButton";

interface CanvasTopbarProps {
  showLayoutDropdown: boolean,
  savedLayouts: Infrastructure[],
  handleOpenCloseDropDownNameClick: () => void,
  handleSelectLayout: (infrastructure: Infrastructure) => void,
  currentLayoutId: string | null,
  currentLayoutName: string | null,
  currentLayoutSaved: boolean,
  handleNew: () => void,
  handleSave: () => void,
  handleUpdate: () => void,
  handleDeploy: () => void,
  handleDelete: () => void,
  isConnecting: boolean,
  handleToggleConnectionLines: () => void
}

export const CanvasTopbar = memo(function CanvasTopbar({
  showLayoutDropdown,
  savedLayouts,
  handleOpenCloseDropDownNameClick,
  handleSelectLayout,
  currentLayoutId,
  currentLayoutName,
  currentLayoutSaved,
  handleNew,
  handleSave,
  handleUpdate,
  handleDeploy,
  handleDelete,
  isConnecting,
  handleToggleConnectionLines
}: CanvasTopbarProps) {
  return (
    <div className="h-12 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
      {/* Logo */}
      <span className="text-sm font-semibold tracking-wide text-gray-200 select-none">
        ⚡ InfraForge
        {/* Below is the dropdown button code to select particular layout */}
        { <InfrastructureLayoutDropdown
          currentLayoutId={ currentLayoutId }
          currentLayoutName={ currentLayoutName }
          showLayoutDropdown={ showLayoutDropdown }
          savedLayouts={ savedLayouts }
          handleOpenCloseDropDownNameClick={ handleOpenCloseDropDownNameClick }
          handleSelectLayout={handleSelectLayout}
        /> }
      </span>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <TopbarActionButton icon="✨" label="New" variant="new" onclick={  handleNew } />
        {currentLayoutId ?
          <TopbarActionButton icon="📝" label="Update" variant="update" onclick={ currentLayoutSaved ? undefined : handleUpdate } />
          :
          <TopbarActionButton icon="💾" label="Save" variant="save" onclick={ handleSave }  />
        }
        {currentLayoutId &&
          <TopbarActionButton  icon="🚀" label="deploy" variant="deploy" onclick={ handleDeploy } />
        }
        <TopbarActionButton icon="X" label="Delete Infrastructure" variant="delete" onclick={ handleDelete } />
        <TopbarActionButton icon="🔗" label={isConnecting ? "Connecting..." : "Connect"} variant={isConnecting ? "deploy" : "default"} onclick={handleToggleConnectionLines} />
      </div>
    </div>
  )
});