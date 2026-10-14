import { memo, useEffect, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useCanvasStore } from "../store/canvasStore";
import { useCanvasViewport, fitCanvasView } from "../hooks/useCanvasViewport";
import { useCanvasConnectionDrag } from "../hooks/useCanvasConnectionDrag";
import { canvasGridStyle } from "../utils/canvasGridStyle";
import { CanvasResourceItem } from "./CanvasResourceItem";
import { ConnectionLinesLayer } from "./ConnectionLinesLayer";
import { PendingConnectionLayer } from "./PendingConnectionLayer";
import { SpawnedReplicaLayer } from "./SpawnedReplicaLayer";

export const CanvasBoard = memo(function CanvasBoard({ label }: { label: string }) {
  const resources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const scale = useCanvasStore((s) => s.scale);
  const translateX = useCanvasStore((s) => s.translateX);
  const translateY = useCanvasStore((s) => s.translateY);
  const currentLayoutId = useCanvasStore((s) => s.currentLayoutId);
  const resourceCount = resources.length;
  const viewport = useCanvasViewport();
  useCanvasConnectionDrag();
  const { setNodeRef } = useDroppable({ id: "canvas" });

  // Reframe on first mount, design switches and the first node; never on single edits.
  const previousLayout = useRef<string | null | undefined>(undefined);
  const previousCount = useRef(0);
  useEffect(() => {
    const first = previousLayout.current === undefined;
    const switched = !first && previousLayout.current !== currentLayoutId;
    const populated = previousCount.current === 0 && resourceCount > 0;
    previousLayout.current = currentLayoutId;
    previousCount.current = resourceCount;
    if (resourceCount === 0 || !(first || switched || populated)) return;
    const frame = requestAnimationFrame(() => fitCanvasView());
    return () => cancelAnimationFrame(frame);
  }, [currentLayoutId, resourceCount]);

  return (
    <div id="canvas" role="group" aria-label={label}
      ref={(el) => { setNodeRef(el); viewport.containerRef.current = el; }}
      className="relative h-full min-w-0 flex-1 cursor-default overflow-hidden"
      style={canvasGridStyle(scale, translateX, translateY)}
      onPointerDown={viewport.handlePanStart} onPointerMove={viewport.handlePanMove} onPointerUp={viewport.handlePanEnd}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const store = useCanvasStore.getState();
        store.setSelectedConnectionId(null); store.setSelectedResourceId(null);
      }}>
      <div className="pointer-events-none absolute top-0 left-0 h-full w-full"
        style={{ transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`, transformOrigin: "0 0" }}>
        <ConnectionLinesLayer resources={resources} connectionLines={connectionLines} scale={scale} />
        <SpawnedReplicaLayer />
        {resources.map((resource) => <CanvasResourceItem key={resource.id} resource={resource} />)}
        <PendingConnectionLayer />
      </div>
    </div>
  );
});
