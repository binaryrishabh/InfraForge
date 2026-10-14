import { memo, useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Resource } from "@infraforge/domain/resource";
import { cx } from "@/ui/cx";
import { CanvasResourcePorts } from "./CanvasResourcePorts";
import { NodeCard } from "./node/NodeCard";
import { useCanvasStore } from "../store/canvasStore";
import { useCardHeight } from "../hooks/useCardHeight";
import { startConnectionFromPort } from "../hooks/useCanvasConnectionDrag";
import { occupiedSidesFor } from "../utils/connectionSides";
import { setGlobalDragCursor } from "../utils/dragCursor";
import { NODE_CARD_WIDTH, GRID_SIZE } from "../utils/nodeGeometry";
import { commitMove, deleteResource, moveResource, nudgeResource, selectResource } from "../actions";

const toCanvas = (clientX: number, clientY: number) => {
  const rect = document.getElementById("canvas")?.getBoundingClientRect();
  const { scale, translateX, translateY } = useCanvasStore.getState();
  return rect ? { x: (clientX - rect.left - translateX) / scale, y: (clientY - rect.top - translateY) / scale } : null;
};

/* A node on the canvas. Pointer: drag to move, drag a port to connect, click to
inspect. Keyboard: Tab to focus, Enter to inspect, arrows to move (Shift for
larger steps), Delete to remove. In a locked live run it can only be inspected. */
export const CanvasResourceItem = memo(function CanvasResourceItem({ resource }: { resource: Resource }) {
  const selected = useCanvasStore((s) => s.selectedResourceId === resource.id);
  const liveMode = useCanvasStore((s) => s.liveMode);
  const locked = useCanvasStore((s) => s.liveLocked || s.isDeploying);
  const occupiedSides = useCanvasStore((s) => occupiedSidesFor(s.resources, s.connectionLines, resource.id));
  const heightRef = useCardHeight(resource.id);
  const drag = useRef<{ offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => () => { if (drag.current?.moved) setGlobalDragCursor(false); }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || locked) return;
    const point = toCanvas(event.clientX, event.clientY);
    if (!point) return;
    drag.current = { offsetX: point.x - resource.x, offsetY: point.y - resource.y, startX: resource.x, startY: resource.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const point = state && toCanvas(event.clientX, event.clientY);
    if (!state || !point) return;
    const x = point.x - state.offsetX, y = point.y - state.offsetY;
    if (!state.moved && Math.hypot(x - state.startX, y - state.startY) > 3) { state.moved = true; setGlobalDragCursor(true); }
    if (state.moved) moveResource(resource.id, x, y);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!state.moved) return;
    setGlobalDragCursor(false);
    suppressClick.current = true;
    const current = useCanvasStore.getState().resources.find((r) => r.id === resource.id);
    if (!current) return;
    const x = Math.round(current.x / GRID_SIZE) * GRID_SIZE, y = Math.round(current.y / GRID_SIZE) * GRID_SIZE;
    moveResource(resource.id, x, y);
    commitMove(resource.id, state.startX, state.startY, x, y);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 4 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectResource(resource.id); }
    else if (moves[event.key] && !locked) { event.preventDefault(); nudgeResource(resource.id, ...moves[event.key]!); }
    else if ((event.key === "Delete" || event.key === "Backspace") && !locked) {
      event.preventDefault();
      // Keep keyboard focus on the canvas: the neighbouring resource, or the canvas itself.
      const all = [...document.querySelectorAll<HTMLElement>("[data-resource-id][role=button]")];
      const index = all.indexOf(event.currentTarget);
      const next = all[index + 1] ?? all[index - 1];
      deleteResource(resource.id);
      setTimeout(() => (next?.isConnected ? next : document.getElementById("main"))?.focus(), 0);
    }
    else if (event.key === "Escape") { event.preventDefault(); selectResource(null); }
  };

  return (
    <div ref={heightRef} data-resource-id={resource.id} role="button" tabIndex={0} aria-pressed={selected}
      aria-label={`${resource.name || resource.id}, ${resource.type}${locked ? "" : ". Arrow keys move, Delete removes, Enter inspects"}`}
      className={cx("group absolute z-10 rounded-md outline-none pointer-events-auto select-none",
        locked ? "cursor-pointer" : "cursor-grab",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        selected && "ring-2 ring-ink ring-offset-2 ring-offset-canvas")}
      style={{ left: resource.x, top: resource.y, width: NODE_CARD_WIDTH }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onKeyDown={onKeyDown}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } selectResource(resource.id); }}>
      <NodeCard resource={resource} mode={liveMode ? "live" : "design"} />
      {!locked && <CanvasResourcePorts resourceId={resource.id} resourceType={resource.type} occupiedSides={occupiedSides} onStartConnection={startConnectionFromPort} />}
    </div>
  );
});
