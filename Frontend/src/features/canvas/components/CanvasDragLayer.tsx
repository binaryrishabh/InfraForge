import { DragOverlay } from "@dnd-kit/core";
import { useCanvasStore } from "../store/canvasStore";
import { ResourceIcon } from "@/components/common/ResourceIcon";

export function CanvasDragLayer() {
  const activeDrag = useCanvasStore((s) => s.activeDrag);
  return (
    <DragOverlay>
      {activeDrag && (
        <div className="w-12 h-12 rounded-lg bg-[#12162F] border border-[#35415A] flex items-center justify-center shadow-xl opacity-90">
          <ResourceIcon type={activeDrag.label} size={24} className="text-blue-400" />
        </div>
      )}
    </DragOverlay>
  );
}