import { PointerSensor, TouchSensor, MouseSensor, useSensor, useSensors } from "@dnd-kit/core";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

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
          // Screen -> canvas space, then center the 48px node on the cursor.
          x = (finalClientX - canvasRect.left - translateX) / scale - 24;
          y = (finalClientY - canvasRect.top - translateY) / scale - 24;
          if (x < 0 || y < 0) return;
          const GRID_SIZE = 24;
          x = Math.round(x / GRID_SIZE) * GRID_SIZE;
          y = Math.round(y / GRID_SIZE) * GRID_SIZE;
        }
        const isOverlapping = store.resources.some(
          (resource) => Math.abs(resource.x - x) < 40 && Math.abs(resource.y - y) < 40
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