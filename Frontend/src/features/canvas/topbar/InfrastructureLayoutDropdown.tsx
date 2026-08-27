import type { Infrastructure } from "@shared/interface/Infrastructure.interface";

interface InfrastructureLayoutDropdownProps {
  currentLayoutId: string | null;
  currentLayoutName: string | null;
  showLayoutDropdown: boolean;
  savedLayouts: Infrastructure[];
  handleOpenCloseDropDownNameClick: () => void;
  handleSelectLayout: (infrastructure: Infrastructure) => void;
}

export function InfrastructureLayoutDropdown({ currentLayoutId, currentLayoutName, showLayoutDropdown, savedLayouts, handleOpenCloseDropDownNameClick, handleSelectLayout }: InfrastructureLayoutDropdownProps) {

  const hasInfra = savedLayouts.length > 0;
  const label = currentLayoutName 
  ? `${ currentLayoutName }`
  : "Select Infrastructure";

  return (
    <span
      className={`relative ml-2 dropdown-container
        ${hasInfra 
          ? "cursor-pointer text-blue-400 hover:text-blue-300" 
          : "text-gray-500 cursor-default" 
        }` 
      }
      onClick={() => hasInfra && handleOpenCloseDropDownNameClick()}
    >
      { label } { hasInfra && "▾"}
      { showLayoutDropdown && hasInfra && <>
        <div 
          className="absolute top-full left-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-50 max-h-40 overflow-y-auto "
        >
          {savedLayouts.map((infrastructure) => {
            const isActive = infrastructure.id === currentLayoutId
            return <div
              key={ infrastructure.id }
              className={`px-3 py-1.5 text-xs cursor-pointer ${
                isActive
                ? "text-blue-400 bg-gray-700 font-medium"
                : "text-gray-300 hover:bg-gray-700 "
              }` }
              onClick={() => handleSelectLayout(infrastructure)}
            >
              { infrastructure.name } {isActive && "✓"}
            </div>
          })}
        </div>
      </>}
    </span>
  )
}