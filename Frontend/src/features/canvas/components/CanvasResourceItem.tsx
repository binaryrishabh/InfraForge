import { memo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { CanvasResourcePorts } from "./CanvasResourcePorts";
import { useCanvasStore } from "../store/canvasStore";
import { startConnectionFromPort } from "../hooks/useCanvasConnectionDrag";
import { hueForType, hueBorder } from "@/theme/resourceCategoryHues";
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
  scale,
  onResourceDoubleClick,
  onDeleteResource,
  onMoveResource,
  onCommitMove,
}: CanvasResourceItemProps) {
  const isSelected = useCanvasStore((s) => s.selectedResourceId === resource.id);
  const isDraggingRef = useRef(false);
  const wasDragRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });

  const inverseScale = scale < 1 ? Math.min(1 / scale, 1.75) : 1;
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
      const pointerCanvasX = (e.clientX - rect.left - translateX) / viewScale;
      const pointerCanvasY = (e.clientY - rect.top - translateY) / viewScale;
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
    const { scale: viewScale, translateX, translateY } = useCanvasStore.getState();
    const pointerCanvasX = (e.clientX - rect.left - translateX) / viewScale;
    const pointerCanvasY = (e.clientY - rect.top - translateY) / viewScale;
    const startPointerX = startPosRef.current.x + dragOffsetRef.current.x;
    const startPointerY = startPosRef.current.y + dragOffsetRef.current.y;
    if (Math.hypot(pointerCanvasX - startPointerX, pointerCanvasY - startPointerY) > 3) {
      wasDragRef.current = true;
    }

    const x = pointerCanvasX - dragOffsetRef.current.x;
    const y = pointerCanvasY - dragOffsetRef.current.y;
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
      const { scale: viewScale, translateX, translateY } = useCanvasStore.getState();
      const pointerCanvasX = (e.clientX - rect.left - translateX) / viewScale;
      const pointerCanvasY = (e.clientY - rect.top - translateY) / viewScale;
      const x = pointerCanvasX - dragOffsetRef.current.x;
      const y = pointerCanvasY - dragOffsetRef.current.y;
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
      className="absolute group w-12 h-12 rounded-lg bg-[#12161F] border border-[#1F2633] hover:border-[var(--hue-border)] flex items-center justify-center cursor-pointer select-none pointer-events-auto transition-colors duration-150"
      style={{
        left: resource.x,
        top: resource.y,
        "--hue-border": hueBorder(hue),
        borderColor: isSelected ? hueBorder(hue) : undefined,
        boxShadow: isSelected ? `0 0 0 2px ${hue}4D` : undefined,
      } as React.CSSProperties}
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
      <span
        className="inline-flex items-center justify-center"
        style={{ transform: `scale(${inverseScale})`, transformOrigin: "center", color: hue }}
      >
        <ResourceIcon type={resource.type} size={20} className="" />
      </span>
      {resource.skuId && scale >= 0.8 && (
        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 pointer-events-none">
          <span
            className="block max-w-16 truncate text-[9px] font-mono text-[#AAB4C5] bg-[#0B0E14]/85 border border-[#1F2633] rounded px-1 whitespace-nowrap"
          >
            {resource.skuId}
          </span>
        </span>
      )}
      <CanvasResourcePorts 
        resourceId={resource.id} 
        resourceType={resource.type} 
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