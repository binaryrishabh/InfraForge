import { DragOverlay } from "@dnd-kit/core";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { useCanvasStore } from "../store/canvasStore";
import { NODE_CARD_WIDTH, NODE_CARD_HEIGHT, DESIGN_CARD_HEIGHT } from "../utils/nodeGeometry";

/* Palette drag preview at the card's on-canvas size, centred on the cursor. */
export function CanvasDragLayer() {
  const activeDrag = useCanvasStore((s) => s.activeDrag);
  const scale = useCanvasStore((s) => s.scale);
  const liveMode = useCanvasStore((s) => s.liveMode);
  if (!activeDrag) return <DragOverlay dropAnimation={null}>{null}</DragOverlay>;
  const height = liveMode ? NODE_CARD_HEIGHT : DESIGN_CARD_HEIGHT;
  const left = (activeDrag.grabOffsetX ?? 0) - (NODE_CARD_WIDTH * scale) / 2;
  const top = (activeDrag.grabOffsetY ?? 0) - (height * scale) / 2;
  return (
    <DragOverlay dropAnimation={null}>
      <div className="relative h-0 w-0">
        <div className="pointer-events-none absolute" style={{ left, top }}>
          <div className="flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-accent bg-surface text-accent"
            style={{ width: NODE_CARD_WIDTH, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <ResourceIcon type={activeDrag.label} size={20} className="" />
            <span className="if-eyebrow">{activeDrag.label}</span>
          </div>
        </div>
      </div>
    </DragOverlay>
  );
}
