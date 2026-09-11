import { DragOverlay } from "@dnd-kit/core";
import { useCanvasStore } from "../store/canvasStore";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { hueForType, hueBorder, hueTint } from "@/theme/resourceCategoryHues";
import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";

/* Palette drag preview. The ghost matches the card's ON-CANVAS footprint at
the current zoom (card dims × canvas scale, borders and content included via
a uniform scale transform) and is always centered on the cursor: the overlay
origin trails the pointer by the grab offset captured at drag start, so we
re-add that offset before centering the scaled box. dropAnimation is null so
the ghost dies exactly where the card lands instead of flying back. */
export function CanvasDragLayer() {
  const activeDrag = useCanvasStore((s) => s.activeDrag);
  const scale = useCanvasStore((s) => s.scale);
  const hue = activeDrag ? hueForType(activeDrag.label) : "#5B8CFF";

  if (!activeDrag) {
    return <DragOverlay dropAnimation={null}>{null}</DragOverlay>;
  }

  // Exact on-canvas footprint at this zoom level.
  const width = NODE_CARD_WIDTH * scale;
  const height = NODE_CARD_HEIGHT * scale;
  // Overlay origin = cursor - grabOffset; re-add it, then center the box.
  const grabX = activeDrag.grabOffsetX ?? 0;
  const grabY = activeDrag.grabOffsetY ?? 0;
  const left = grabX - width / 2;
  const top = grabY - height / 2;

  return (
    <DragOverlay dropAnimation={null}>
      <div className="relative w-0 h-0">
        <div
          className="absolute pointer-events-none"
          style={{ left, top, width, height }}
        >
          <div
            className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5"
            style={{
              width: NODE_CARD_WIDTH,
              height: NODE_CARD_HEIGHT,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              borderColor: hueBorder(hue),
              background: hueTint(hue),
              color: hue,
              boxShadow: `0 12px 32px rgba(0,0,0,0.45)`,
            }}
          >
            <ResourceIcon type={activeDrag.label} size={20} className="" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#AAB4C5]">
              {activeDrag.label}
            </span>
          </div>
        </div>
      </div>
    </DragOverlay>
  );
}