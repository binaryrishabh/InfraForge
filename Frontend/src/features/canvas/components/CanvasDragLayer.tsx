import { DragOverlay } from "@dnd-kit/core";
import { useCanvasStore } from "../store/canvasStore";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { hueForType, hueBorder, hueTint } from "@/theme/resourceCategoryHues";
import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";

/* Palette drag preview. The ghost is the EXACT footprint the card will
   occupy (centered on the pointer, same as the drop math), so the space a
   node claims is visible while dragging — no more invisible rejections. */
export function CanvasDragLayer() {
  const activeDrag = useCanvasStore((s) => s.activeDrag);
  const hue = activeDrag ? hueForType(activeDrag.label) : "#5B8CFF";

  return (
    <DragOverlay>
      {activeDrag && (
        <div className="relative w-0 h-0">
          <div
            className="absolute rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 pointer-events-none"
            style={{
              width: NODE_CARD_WIDTH,
              height: NODE_CARD_HEIGHT,
              left: -NODE_CARD_WIDTH / 2,
              top: -NODE_CARD_HEIGHT / 2,
              borderColor: hueBorder(hue),
              background: hueTint(hue),
              color: hue,
              boxShadow: `0 12px 32px rgba(0,0,0,0.45)`,
            }}
          >
            <ResourceIcon type={activeDrag.label} size={24} className="" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#AAB4C5]">
              {activeDrag.label}
            </span>
          </div>
        </div>
      )}
    </DragOverlay>
  );
}