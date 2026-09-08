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
    ? `${currentLayoutName}`
    : "Select Infrastructure";
  return (
    <span
      className={`relative ml-1 dropdown-container flex items-center gap-1 min-w-0
        ${hasInfra
          ? "cursor-pointer text-blue-400 hover:text-blue-300"
          : "text-gray-500 cursor-default"
        }`}
      onClick={() => hasInfra && handleOpenCloseDropDownNameClick()}
    >
      {/* Truncated label so long layout names never blow out the half-width bar.
          The menu lives outside this span, so truncation can't clip it. */}
      <span className="inline-block max-w-32 truncate text-sm font-medium">
        {label}
      </span>
      {hasInfra && <span className="shrink-0">▾</span>}
      {showLayoutDropdown && hasInfra && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-50 max-h-40 overflow-y-auto">
          {savedLayouts.map((infrastructure) => {
            const isActive = infrastructure.id === currentLayoutId;
            return (
              <div
                key={infrastructure.id}
                className={`px-3 py-1.5 text-xs cursor-pointer ${
                  isActive
                    ? "text-blue-400 bg-gray-700 font-medium"
                    : "text-gray-300 hover:bg-gray-700"
                }`}
                onClick={() => handleSelectLayout(infrastructure)}
              >
                {infrastructure.name} {isActive && "✓"}
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}