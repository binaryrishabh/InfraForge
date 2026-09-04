import { memo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { CanvasResourcePorts } from "./CanvasResourcePorts";
import { useCanvasStore } from "../store/canvasStore";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

interface CanvasResourceItemProps {
  resource: Resource;
  onResourceClick: (resourceId: string, resourceType: ResourceType) => void;
  onResourceDoubleClick: (resourceId: string) => void;
  onDeleteResource: (resourceId: string) => void;
  onMoveResource: (resourceId: string, x: number, y: number) => void;
  onCommitMove: (resourceId: string, fromX: number, fromY: number, toX: number, toY: number) => void;
}

const GRID_SIZE = 24;

export const CanvasResourceItem = memo(function CanvasResourceItem({
  resource,
  onResourceClick,
  onResourceDoubleClick,
  onDeleteResource,
  onMoveResource,
  onCommitMove,
}: CanvasResourceItemProps) {
  const isSelected = useCanvasStore((s) => s.selectedResourceId === resource.id);
  const isConnecting = useCanvasStore((s) => s.isConnecting);

  const isDraggingRef = useRef(false);
  const wasDragRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    wasDragRef.current = false;
    startPosRef.current = { x: resource.x, y: resource.y };
    const canvas = document.getElementById("canvas");
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const { scale, translateX, translateY } = useCanvasStore.getState();
      // Grab offset in CANVAS space (not raw screen space) so it survives zoom.
      const pointerCanvasX = (e.clientX - rect.left - translateX) / scale;
      const pointerCanvasY = (e.clientY - rect.top - translateY) / scale;
      dragOffsetRef.current = {
        x: pointerCanvasX - resource.x,
        y: pointerCanvasY - resource.y,
      };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const canvas = document.getElementById("canvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, translateX, translateY } = useCanvasStore.getState();
    const pointerCanvasX = (e.clientX - rect.left - translateX) / scale;
    const pointerCanvasY = (e.clientY - rect.top - translateY) / scale;
    const startPointerX = startPosRef.current.x + dragOffsetRef.current.x;
    const startPointerY = startPosRef.current.y + dragOffsetRef.current.y;
    if (Math.hypot(pointerCanvasX - startPointerX, pointerCanvasY - startPointerY) > 3) {
      wasDragRef.current = true;
    }
    const x = Math.max(0, pointerCanvasX - dragOffsetRef.current.x);
    const y = Math.max(0, pointerCanvasY - dragOffsetRef.current.y);
    onMoveResource(resource.id, x, y);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (wasDragRef.current) {
      const canvas = document.getElementById("canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { scale, translateX, translateY } = useCanvasStore.getState();
      const pointerCanvasX = (e.clientX - rect.left - translateX) / scale;
      const pointerCanvasY = (e.clientY - rect.top - translateY) / scale;
      const x = Math.max(0, pointerCanvasX - dragOffsetRef.current.x);
      const y = Math.max(0, pointerCanvasY - dragOffsetRef.current.y);
      const snappedX = Math.round(x / GRID_SIZE) * GRID_SIZE;
      const snappedY = Math.round(y / GRID_SIZE) * GRID_SIZE;
      onMoveResource(resource.id, snappedX, snappedY);
      onCommitMove(resource.id, startPosRef.current.x, startPosRef.current.y, snappedX, snappedY);
    }
  };

  const handleClick = () => {
    if (wasDragRef.current) {
      wasDragRef.current = false;
      return;
    }
    onResourceClick(resource.id, resource.type);
  };

  return (
    <div
      title={resource.type}
      className={`absolute group w-12 h-12 rounded-lg bg-[#12161F] border flex items-center justify-center cursor-pointer select-none pointer-events-auto transition-colors duration-150 ${
        isSelected
          ? "border-blue-500/60 ring-2 ring-blue-500/30"
          : "border-[#1F2633] hover:border-[#35415A]"
      }`}
      style={{ left: resource.x, top: resource.y }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onDoubleClick={() => onResourceDoubleClick(resource.id)}
    >
      <ResourceIcon type={resource.type} size={20} />
      {resource.skuId && (
        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 max-w-16 truncate text-[8px] font-mono text-[#AAB4C5] bg-[#0B0E14]/85 border border-[#1F2633] rounded px-1 pointer-events-none whitespace-nowrap">
          {resource.skuId}
        </span>
      )}
      <CanvasResourcePorts isConnecting={isConnecting} />
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