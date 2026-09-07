import { memo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { CanvasResourcePorts } from "./CanvasResourcePorts";
import { useCanvasStore } from "../store/canvasStore";
import { startConnectionFromPort } from "../hooks/useCanvasConnectionDrag";
import { occupiedSidesFor } from "../utils/connectionSides";
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
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });

  const hue = hueForType(resource.type);

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
    if (Math.hypot(pointerCanvasX - startPointerX, pointerCanvasY - startPointerY) > 3) {
      wasDragRef.current = true;
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
    <div
      data-resource-id={resource.id}
      title={resource.type}
      className="absolute group rounded-xl pointer-events-auto cursor-pointer select-none"
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
        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 hover:bg-red-400 text-white text-[12px] flex items-center justify-center leading-none opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-md"
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