import { useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { hueForType, hueTint } from "@/theme/resourceCategoryHues";
import { setGlobalDragCursor } from "../utils/dragCursor";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

interface ResourcePaletteItemProps {
  label: ResourceType;
  sublabel: string;
  capacity: string;
}

export function ResourcePaletteItem({
  label,
  sublabel,
  capacity,
}: ResourcePaletteItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: label,
      data: { label },
    });

  // While dnd-kit drags this palette row, force the grabbing cursor globally.
  useEffect(() => {
    if (!isDragging) return;
    setGlobalDragCursor(true);
    return () => setGlobalDragCursor(false);
  }, [isDragging]);

  const hue = hueForType(label);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // Drag anchor: onDragStart measures this row's rect synchronously so
      // the ghost can center on the cursor from the first frame.
      data-palette-row={label}
      className="flex items-center gap-2.5 h-12 px-2 rounded-lg border border-transparent hover:border-[#273042] hover:bg-[#171C27] cursor-grab active:cursor-grabbing transition-colors duration-150 group select-none"
      style={transform ? { opacity: 0.4 } : undefined}
      title={label}
    >
      <span
        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
        style={{ background: hueTint(hue), color: hue }}
      >
        <ResourceIcon type={label} size={16} className="" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-[#AAB4C5] group-hover:text-[#EDF1F7] transition-colors duration-150 truncate">
          {label}
        </span>
        <span className="block text-[10px] text-[#677185] truncate">
          {sublabel}
        </span>
      </span>
      <span className="text-[10px] font-mono text-[#677185] tabular-nums shrink-0">
        {capacity}
      </span>
    </div>
  );
}