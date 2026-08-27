import { useState } from "react";
import { PointerSensor, TouchSensor, MouseSensor, useSensor, useSensors } from "@dnd-kit/core";
import { toast } from "sonner";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";
import type { UndoCanvasResourceAction } from "@shared/types/UndoCanvasResourceAction.types";

interface UseCanvasDragDropProps {
  canvasResources: Resource[];
  setCanvasResources: React.Dispatch<React.SetStateAction<Resource[]>>;
  setCurrentLayoutSaved: (saved: boolean) => void;
  setIsInitialized: (initialized: boolean) => void;
  setUndoResourcesSnapshotStackTrace: React.Dispatch<React.SetStateAction<UndoCanvasResourceAction[]>>;
  setRedoResourcesSnapshotStackTrace: (stack: UndoCanvasResourceAction[]) => void;
  currentLayoutSaved: boolean;
}

export function useCanvasDragDrop({
  canvasResources,
  setCanvasResources,
  setCurrentLayoutSaved,
  setIsInitialized,
  setUndoResourcesSnapshotStackTrace,
  setRedoResourcesSnapshotStackTrace,
  currentLayoutSaved,
}: UseCanvasDragDropProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Must move 5px before drag starts (prevents accidental dragging on clicks)
      },
    }),
    useSensor(TouchSensor),
    useSensor(MouseSensor),
  );

  const [activeDrag, setActiveDrag] = useState<{ label: ResourceType } | null>(null);

  return {
    sensors,
    activeDrag,
    setActiveDrag,
    onDragStart: (event: any) => {
      const label = event.active.id as ResourceType;
      setActiveDrag({ label });
      console.log("Drag started:", event.active.id);
    },
    onDragEnd: (event: any) => {
      setActiveDrag(null);

      console.log("over id: ", event.over?.id);

      if (event.over?.id === "canvas") {
        setCurrentLayoutSaved(false); // tracking there was a new resource added to the canvas
        setIsInitialized(true); // saving to localstorage there was a new resource added to the canvas

        const { active, delta } = event;

        // Get the canvas element
        const canvas = document.querySelector("#canvas") as HTMLElement;
        const canvasRect = canvas?.getBoundingClientRect();

        // calculate drop position relative to canvas using delta
        let x = 50, y = 50;
        if (canvasRect) {
          // Get the initial position of the drag relative to canvas
          const pointerEvent = event.activatorEvent as PointerEvent;
          x = pointerEvent.clientX - canvasRect.left + delta.x - 20; // these - constant values are according to the visuals
          y = pointerEvent.clientY - canvasRect.top + delta.y - 20;

          if (x < 0 || y < 0) {
            return;
          }

          const GRID_SIZE = 24; // matches background dot grid

          x = Math.round(x / GRID_SIZE) * GRID_SIZE;
          y = Math.round(y / GRID_SIZE) * GRID_SIZE;
        }

        const isOverlapping = canvasResources.some(
          (resource) => Math.abs(resource.x - x) < 40 && Math.abs(resource.y - y) < 40
        );

        if (isOverlapping) {
          toast.warning("Space already occupied!");
          return;
        }

        console.log("Drag ended:", event.active.id, event.over?.id, x, y);

        const newResource: Resource = {
          id: `${active.id}-${Date.now()}`,
          type: active.id as ResourceType,
          x,
          y,
        };

        setCanvasResources((prev) => [
          ...prev,
          newResource,
        ]);

        // Pushing the added resource on the canvas to the UndoStack
        setUndoResourcesSnapshotStackTrace(prev => [...prev, {
          type: "add",
          resource: newResource,
          connectionLines: [],
          savedState: currentLayoutSaved,
        }]);

        // Any new addition to the canvas clears the redo as redo points to previous timeline and new addtion has created a new timeline
        setRedoResourcesSnapshotStackTrace([]);
      }
    },
  };
}