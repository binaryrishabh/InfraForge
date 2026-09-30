import { memo, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";
import { CanvasResourcePorts } from "./CanvasResourcePorts";
import { useCanvasStore } from "../store/canvasStore";
import { useCardHeight } from "../hooks/useCardHeight";
import { startConnectionFromPort } from "../hooks/useCanvasConnectionDrag";
import { occupiedSidesFor } from "../utils/connectionSides";
import { setGlobalDragCursor } from "../utils/dragCursor";
import {
  MonitoringDashboardCard,
  NODE_CARD_WIDTH,
} from "@/features/monitoring/components/MonitoringDashboardCard";
import type { Resource } from "@shared/interface/Resource.interface";

interface CanvasResourceItemProps {
  resource: Resource;
  scale: number;
  onDeleteResource: (resourceId: string) => void;
  onMoveResource: (resourceId: string, x: number, y: number) => void;
  onCommitMove: (resourceId: string, fromX: number, fromY: number, toX: number, toY: number) => void;
}

const GRID_SIZE = 24;

export const CanvasResourceItem = memo(function CanvasResourceItem({
  resource,
  onDeleteResource,
  onMoveResource,
  onCommitMove,
}: CanvasResourceItemProps) {
  const isSelected = useCanvasStore((s) => s.selectedResourceId === resource.id);
  const liveMode = useCanvasStore((s) => s.liveMode);
  const occupiedSides = useCanvasStore((s) =>
    occupiedSidesFor(s.resources, s.connectionLines, resource.id)
  );
  // Feed the wrapper's real rendered height into the store so connection
  // anchors land exactly on the port dots at any card height.
  const cardHeightRef = useCardHeight(resource.id);
  const isDraggingRef = useRef(false);
  const wasDragRef = useRef(false);
  const dragCursorActiveRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });

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

  // Single click: select AND open the inspector. The wasDragRef guard keeps
  // drags from triggering it; the shell ignores node pointerdowns for its
  // outside-click dismissal, so clicking nodes switches instead of closing.
  const handleClick = () => {
    if (wasDragRef.current) {
      wasDragRef.current = false;
      return;
    }
    const store = useCanvasStore.getState();
    store.setSelectedResourceId(resource.id);
    store.setSelectedResourceForConfigId(resource.id);
  };

  return (
    // z-10 makes this wrapper a stacking context: its ports (z-20) and delete
    // button stay INSIDE it, so they can never paint above a sibling card.
    <div
      ref={cardHeightRef}
      data-resource-id={resource.id}
      title={resource.type}
      className="absolute group rounded-md pointer-events-auto cursor-grab select-none z-10"
      style={{
        left: resource.x,
        top: resource.y,
        width: NODE_CARD_WIDTH,
        // Selection = active state = muted teal ring, never a glow.
        boxShadow: isSelected ? "0 0 0 2px rgba(79, 168, 155, 0.45)" : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
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
      {/* Delete chip: brick ghost at rest, solid brick on its own hover. */}
      <button
        type="button"
        title="Delete node"
        aria-label={`Delete ${resource.id}`}
        className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 active:scale-90 transition-all duration-150 cursor-pointer bg-[#1C1F26] border border-[#C4574A]/40 text-[#C4574A] hover:bg-[#C4574A] hover:border-[#C4574A] hover:text-[#14161A] shadow-[0_4px_12px_rgba(0,0,0,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4574A]/50"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDeleteResource(resource.id);
        }}
      >
        <X size={12} strokeWidth={2.25} />
      </button>
    </div>
  );
});