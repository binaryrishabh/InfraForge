import { useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { ResourceType } from "@infraforge/domain/resource";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { categoryColor } from "@/theme/categories";
import { cx } from "@/ui/cx";
import { setGlobalDragCursor } from "../../utils/dragCursor";
import { PRODUCT_SUBLABELS, capacityLabel } from "../../utils/paletteMetadata";
import { addResource } from "../../actions";

export function PaletteItem({ type, disabled, onAdded }: { type: ResourceType; disabled: boolean; onAdded?: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: type, data: { label: type }, disabled });
  useEffect(() => {
    if (!isDragging) return;
    setGlobalDragCursor(true);
    return () => setGlobalDragCursor(false);
  }, [isDragging]);
  return (
    <button ref={setNodeRef} type="button" {...listeners} {...attributes} role="button" data-palette-row={type} disabled={disabled}
      aria-label={`Add ${type}`} aria-describedby={undefined} onClick={() => { if (addResource(type)) onAdded?.(); }}
      className={cx("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sunken disabled:opacity-40",
        "cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-line bg-raised" style={{ color: categoryColor(type) }}>
        <ResourceIcon type={type} size={15} className="" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{type}</span>
        <span className="block truncate text-[11px] text-ink-3">{PRODUCT_SUBLABELS[type]}</span>
      </span>
      <span className="if-num shrink-0 text-[10.5px] text-ink-3">{capacityLabel(type)}</span>
    </button>
  );
}
