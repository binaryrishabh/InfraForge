import { memo, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { CanvasResourcePorts } from "./CanvasResourcePorts";
import { useCanvasStore } from "../store/canvasStore";
import { startConnectionFromPort } from "../hooks/useCanvasConnectionDrag";
import { occupiedSidesFor } from "../utils/connectionSides";
import { setGlobalDragCursor } from "../utils/dragCursor";
import { hueForType } from "@/theme/resourceCategoryHues";
import {
  MonitoringDashboardCard,
  NODE_CARD_WIDTH,
} from "@/features/monitoring/components/MonitoringDashboardCard";
import type { Resource } from "@shared/interface/Resource.interface";

interface CanvasResourceItemProps {
  resource: Resource;
  scale: number;
  onResourceDoubleClick: (resourceId: string) => void;
  onDeleteResource: (resourceId: string) => void;
  onMoveResource: (resourceId: string, x: number, y: number) => void;
  onCommitMove: (resourceId: string, fromX: number, fromY: number, toX: number, toY: number) => void;
}

const GRID_SIZE = 24;

export const CanvasResourceItem = memo(function CanvasResourceItem({
  resource,
  onResourceDoubleClick,
  onDeleteResource,
  onMoveResource,
  onCommitMove,
}: CanvasResourceItemProps) {
  const isSelected = useCanvasStore((s) => s.selectedResourceId === resource.id);
  const liveMode = useCanvasStore((s) => s.liveMode);
  const occupiedSides = useCanvasStore((s) =>
    occupiedSidesFor(s.resources, s.connectionLines, resource.id)
  );
  const isDraggingRef = useRef(false);
  const wasDragRef = useRef(false);
  const dragCursorActiveRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });

  const hue = hueForType(resource.type);

  // Safety net: never leave the global grabbing cursor stuck if this item
  // unmounts mid-drag (e.g. a live topology sync removes it).
  useEffect(() => {
    return () => {
      if (dragCursorActiveRef.current) {
        dragCursorActiveRef.current = false;
        setGlobalDragCursor(false);
      }
    };
  }, []);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    wasDragRef.current = false;
    startPosRef.current = { x: resource.x, y: resource.y };
    const canvas = document.getElementById("canvas");
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const { scale: viewScale, translateX, translateY } = useCanvasStore.getState();
      dragOffsetRef.current = {
        x: (e.clientX - rect.left - translateX) / viewScale - resource.x,
        y: (e.clientY - rect.top - translateY) / viewScale - resource.y,
      };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const canvas = document.getElementById("canvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { scale: viewScale, translateX, translateY } = useCanvasStore.getState();
    const pointerCanvasX = (e.clientX - rect.left - translateX) / viewScale;
    const pointerCanvasY = (e.clientY - rect.top - translateY) / viewScale;
    const startPointerX = startPosRef.current.x + dragOffsetRef.current.x;
    const startPointerY = startPosRef.current.y + dragOffsetRef.current.y;
    // Grabbing cursor only once real movement begins, so plain clicks on a
    // card never flash the dragging cursor.
    if (
      !wasDragRef.current &&
      Math.hypot(pointerCanvasX - startPointerX, pointerCanvasY - startPointerY) > 3
    ) {
      wasDragRef.current = true;
      dragCursorActiveRef.current = true;
      setGlobalDragCursor(true);
    }
    onMoveResource(
      resource.id,
      pointerCanvasX - dragOffsetRef.current.x,
      pointerCanvasY - dragOffsetRef.current.y,
    );
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (dragCursorActiveRef.current) {
      dragCursorActiveRef.current = false;
      setGlobalDragCursor(false);
    }
    if (wasDragRef.current) {
      const canvas = document.getElementById("canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { scale: viewScale, translateX, translateY } = useCanvasStore.getState();
      const x = (e.clientX - rect.left - translateX) / viewScale - dragOffsetRef.current.x;
      const y = (e.clientY - rect.top - translateY) / viewScale - dragOffsetRef.current.y;
      const snappedX = Math.round(x / GRID_SIZE) * GRID_SIZE;
      const snappedY = Math.round(y / GRID_SIZE) * GRID_SIZE;
      onMoveResource(resource.id, snappedX, snappedY);
      onCommitMove(resource.id, startPosRef.current.x, startPosRef.current.y, snappedX, snappedY);
    }
  };

  return (
    // z-10 makes this wrapper a stacking context: its ports (z-20) and delete
    // button stay INSIDE it, so they can never paint above a sibling card.
    // Sibling cards share z-10 and paint in DOM order, line svg sits at z-0.
    <div
      data-resource-id={resource.id}
      title={resource.type}
      className="absolute group rounded-xl pointer-events-auto cursor-grab select-none z-10"
      style={{
        left: resource.x,
        top: resource.y,
        width: NODE_CARD_WIDTH,
        boxShadow: isSelected ? `0 0 0 2px ${hue}4D` : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={() => {
        if (wasDragRef.current) {
          wasDragRef.current = false;
          return;
        }
        useCanvasStore.getState().setSelectedResourceId(resource.id);
      }}
      onDoubleClick={() => onResourceDoubleClick(resource.id)}
    >
      <MonitoringDashboardCard
        resource={resource}
        mode={liveMode ? "live" : "design"}
        asContent
      />
      <CanvasResourcePorts
        resourceId={resource.id}
        resourceType={resource.type}
        occupiedSides={occupiedSides}
        onStartConnection={startConnectionFromPort}
      />
      <button
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 hover:bg-red-400 text-white text-[11px] flex items-center justify-center leading-none opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-md"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDeleteResource(resource.id);
        }}
      >
        X
      </button>
    </div>
  );
});