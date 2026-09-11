import {
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  MeasuringStrategy,
  type CollisionDetection,
  type MeasuringConfiguration,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import { positionIsOccupied } from "../utils/cardFootprint";
import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

const GRID_SIZE = 24;

/* Pointer-first collision: the drop target is whichever droppable actually
contains the pointer; fall back to rect overlap when the pointer sits over
floating chrome. With one full-screen canvas droppable this keeps `over`
deterministic instead of occasionally resolving to null (which read as
"drop does nothing"). */
const canvasCollisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

/* Re-measure droppables continuously during a drag so the canvas rect is
never stale (pan/zoom or layout shifts mid-drag used to invalidate it). */
export const CANVAS_MEASURING: Partial<MeasuringConfiguration> = {
  droppable: { strategy: MeasuringStrategy.Always },
};

export function useCanvasDragDrop() {
  // PointerSensor alone covers mouse + touch + pen. Registering MouseSensor
  // and TouchSensor alongside it caused double activation: the drag started,
  // then one of the duplicate sensors cancelled it silently, so drops never
  // landed. One sensor, one activation path.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  return {
    sensors,
    collisionDetection: canvasCollisionDetection,
    measuring: CANVAS_MEASURING,
    onDragStart: (event: any) => {
      const label = event.active.id as ResourceType;
      // Where inside the palette row the pointer pressed. The DragOverlay
      // origin trails the cursor by exactly this offset for the whole drag,
      // so CanvasDragLayer re-adds it to keep the ghost centered on the
      // cursor from the very first frame. Measured synchronously from the
      // pressed row element (data-palette-row), falling back to dnd-kit's
      // measured active rect if the anchor is ever missing.
      const activator = event.activatorEvent as PointerEvent | undefined;
      const rowElement = (
        activator?.target as HTMLElement | undefined
      )?.closest?.("[data-palette-row]");
      const rowRect =
        rowElement?.getBoundingClientRect() ??
        event.active?.rect?.current?.initial ??
        null;
      const grabOffsetX =
        rowRect && typeof activator?.clientX === "number"
          ? activator.clientX - rowRect.left
          : 0;
      const grabOffsetY =
        rowRect && typeof activator?.clientY === "number"
          ? activator.clientY - rowRect.top
          : 0;
      useCanvasStore
        .getState()
        .setActiveDrag({ label, grabOffsetX, grabOffsetY });
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

        // Only a REAL rectangle overlap (plus a small pack gap) rejects now.
        if (positionIsOccupied(store.resources, x, y)) {
          toast.warning("Space already occupied!");
          return;
        }

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