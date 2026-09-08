import { Check, ChevronDown, FolderOpen } from "lucide-react";
import type { Infrastructure } from "@shared/interface/Infrastructure.interface";

interface InfrastructureLayoutDropdownProps {
  currentLayoutId: string | null;
  currentLayoutName: string | null;
  showLayoutDropdown: boolean;
  savedLayouts: Infrastructure[];
  handleOpenCloseDropDownNameClick: () => void;
  handleSelectLayout: (infrastructure: Infrastructure) => void;
}

export function InfrastructureLayoutDropdown({
  currentLayoutId,
  currentLayoutName,
  showLayoutDropdown,
  savedLayouts,
  handleOpenCloseDropDownNameClick,
  handleSelectLayout,
}: InfrastructureLayoutDropdownProps) {
  const hasInfra = savedLayouts.length > 0;
  const label = currentLayoutName ? currentLayoutName : "Select Infrastructure";

  return (
    // dropdown-container class is required by useInfrastructureDropdown's
    // outside-click handler — keep it on the wrapper.
    <span className="relative dropdown-container min-w-0">
      <button
        type="button"
        disabled={!hasInfra}
        onClick={() => hasInfra && handleOpenCloseDropDownNameClick()}
        className={`flex items-center gap-2 h-8 px-2.5 rounded-lg border min-w-0 max-w-44 transition-colors duration-150 ${
          !hasInfra
            ? "border-[#1F2633] bg-[#12161F] text-[#677185] cursor-not-allowed"
            : showLayoutDropdown
              ? "border-[#5B8CFF]/60 bg-[#171C27] text-[#EDF1F7] cursor-pointer"
              : "border-[#273042] bg-[#171C27] text-[#AAB4C5] hover:border-[#35415A] hover:text-[#EDF1F7] cursor-pointer"
        }`}
      >
        <FolderOpen size={14} strokeWidth={1.75} className="shrink-0 text-[#5B8CFF]" />
        <span className="truncate text-[12px] font-medium">{label}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          className={`shrink-0 text-[#677185] transition-transform duration-150 ${
            showLayoutDropdown ? "rotate-180" : ""
          }`}
        />
      </button>

      {showLayoutDropdown && hasInfra && (
        <div className="infraforge-drop-in absolute top-full left-0 mt-2 w-64 rounded-xl border border-[#273042] bg-[#12161F]/95 backdrop-blur-md shadow-[0_16px_40px_rgba(0,0,0,0.5)] z-50 overflow-hidden">
          {/* Menu header */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-[#1F2633]">
            <span className="text-[9px] uppercase tracking-wider text-[#677185] font-semibold">
              Saved layouts
            </span>
            <span className="text-[9px] font-mono text-[#677185]">
              {savedLayouts.length}
            </span>
          </div>
          {/* Layout rows */}
          <div className="p-1.5 max-h-64 overflow-y-auto">
            {savedLayouts.map((infrastructure) => {
              const isActive = infrastructure.id === currentLayoutId;
              const resourceCount = (infrastructure.layout?.resources ?? []).length;
              return (
                <button
                  key={infrastructure.id}
                  type="button"
                  onClick={() => handleSelectLayout(infrastructure)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors duration-150 ${
                    isActive
                      ? "bg-[rgba(91,140,255,0.10)] text-[#5B8CFF]"
                      : "text-[#AAB4C5] hover:bg-[#171C27] hover:text-[#EDF1F7]"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">
                      {infrastructure.name}
                    </span>
                    <span className="block text-[10px] font-mono text-[#677185] mt-0.5">
                      {resourceCount} resources ·{" "}
                      {new Date(infrastructure.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  {isActive && <Check size={14} strokeWidth={2} className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}