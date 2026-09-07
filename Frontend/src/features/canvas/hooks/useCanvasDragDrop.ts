import { PointerSensor, TouchSensor, MouseSensor, useSensor, useSensors } from "@dnd-kit/core";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

const GRID_SIZE = 24;
// Card-sized overlap thresholds: card dimension + a 20px breathing gap.
const CARD_OVERLAP_X = NODE_CARD_WIDTH + 20;
const CARD_OVERLAP_Y = NODE_CARD_HEIGHT + 20;

export function useCanvasDragDrop() {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor),
    useSensor(MouseSensor),
  );

  return {
    sensors,
    onDragStart: (event: any) => {
      const label = event.active.id as ResourceType;
      useCanvasStore.getState().setActiveDrag({ label });
    },
    onDragEnd: (event: any) => {
      const store = useCanvasStore.getState();
      store.setActiveDrag(null);

      if (event.over?.id === "canvas") {
        store.setCurrentLayoutSaved(false);
        store.setIsInitialized(true);

        const { active, delta } = event;
        const canvas = document.querySelector("#canvas") as HTMLElement;
        const canvasRect = canvas?.getBoundingClientRect();
        let x = 50, y = 50;

        if (canvasRect) {
          const { scale, translateX, translateY } = store;
          const pointerEvent = event.activatorEvent as PointerEvent;

          // Final pointer position = activator position + total drag delta.
          const finalClientX = pointerEvent.clientX + delta.x;
          const finalClientY = pointerEvent.clientY + delta.y;

          // Screen -> canvas space, then center the card on the cursor.
          x = (finalClientX - canvasRect.left - translateX) / scale - NODE_CARD_WIDTH / 2;
          y = (finalClientY - canvasRect.top - translateY) / scale - NODE_CARD_HEIGHT / 2;

          x = Math.round(x / GRID_SIZE) * GRID_SIZE;
          y = Math.round(y / GRID_SIZE) * GRID_SIZE;
        }

        const isOverlapping = store.resources.some(
          (resource) =>
            Math.abs(resource.x - x) < CARD_OVERLAP_X &&
            Math.abs(resource.y - y) < CARD_OVERLAP_Y
        );
        if (isOverlapping) { toast.warning("Space already occupied!"); return; }

        const newResource = { id: `${active.id}-${Date.now()}`, type: active.id as ResourceType, x, y };
        store.setResources((prev) => [...prev, newResource]);
        store.setUndoStack(prev => [...prev, {
          type: "add", resource: newResource, connectionLines: [], savedState: store.currentLayoutSaved,
        }]);
        store.setRedoStack([]);
      }
    },
  };
}