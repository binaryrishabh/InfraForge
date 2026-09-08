import { useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { hueForType, hueBorder } from "@/theme/resourceCategoryHues";
import { setGlobalDragCursor } from "../utils/dragCursor";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

export function ResourceSidebarItem({ label }: { label: ResourceType }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: label,
    data: { label },
  });

  // While dnd-kit drags this palette item, force the grabbing cursor
  // globally — the ghost follows the pointer across the whole canvas.
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
      className="w-12 h-12 rounded-lg bg-[#12161F] border border-[#1F2633] hover:border-(--hue-border) hover:bg-[#171C27] cursor-pointer flex items-center justify-center transition-colors duration-150 group"
      style={
        transform
          ? { opacity: 0.4, transform: "none", "--hue-border": hueBorder(hue) } as React.CSSProperties
          : { "--hue-border": hueBorder(hue) } as React.CSSProperties
      }
      title={label}
    >
      <span style={{ color: hue }} className="inline-flex">
        <ResourceIcon type={label} size={20} className="" />
      </span>
    </div>
  );
}