import { ResourceIcon } from "@/components/common/ResourceIcon";
import { CanvasResourcePorts } from "./CanvasResourcePorts";
import type { Resource } from "@shared/types/Resource.types";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

interface CanvasResourceItemProps {
  resource: Resource;
  isSelected: boolean;
  isConnecting: boolean;
  onResourceClick: (resourceId: string, resourceType: ResourceType) => void;
  onResourceDoubleClick: (resourceId: string) => void;
  onDeleteResource: (resourceId: string) => void;
}

export function CanvasResourceItem({
  resource,
  isSelected,
  isConnecting,
  onResourceClick,
  onResourceDoubleClick,
  onDeleteResource,
}: CanvasResourceItemProps) {
  return (
    <div
      title={resource.type}
      className={`absolute group w-12 h-12 rounded-lg bg-[#12161F] border flex items-center justify-center cursor-pointer transition-colors duration-150 ${
        isSelected
          ? "border-blue-500/60 ring-2 ring-blue-500/30"
          : "border-[#1F2633] hover:border-[#35415A]"
      }`}
      style={{ left: resource.x, top: resource.y }}
      onClick={() => onResourceClick(resource.id, resource.type)}
      onDoubleClick={() => onResourceDoubleClick(resource.id)}
    >
      <ResourceIcon type={resource.type} size={20} />
      {resource.skuId && (
        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 max-w-16 truncate text-[8px] font-mono text-[#AAB4C5] bg-[#0B0E14]/85 border border-[#1F2633] rounded px-1 pointer-events-none whitespace-nowrap">
          {resource.skuId}
        </span>
      )}
      <CanvasResourcePorts isConnecting={isConnecting} />
      <button
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 hover:bg-red-400 text-white text-[11px] flex items-center justify-center leading-none opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-md"
        onClick={(e) => {
          e.stopPropagation();
          onDeleteResource(resource.id);
        }}
      >
        X
      </button>
    </div>
  );
}