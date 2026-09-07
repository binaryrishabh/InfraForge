import { useDraggable } from "@dnd-kit/core"
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { hueForType, hueBorder } from "@/theme/resourceCategoryHues";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

export function ResourceSidebarItem({ label }: { label: ResourceType }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: label,
    data: { label }
  })

  const hue = hueForType(label);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="w-12 h-12 rounded-lg bg-[#12161F] border border-[#1F2633] hover:border-(--hue-border) hover:bg-[#171C27] cursor-grab flex items-center justify-center transition-colors duration-150 group"
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
  )
}