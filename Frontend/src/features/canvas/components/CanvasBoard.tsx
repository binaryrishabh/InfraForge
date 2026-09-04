import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useCanvasStore } from "../store/canvasStore";
import { useCanvasResourceActions } from "../hooks/useCanvasResourceActions";
import { useCanvasConnectionActions } from "../hooks/useCanvasConnectionActions";
import { useCanvasViewport } from "../hooks/useCanvasViewport";
import { CanvasResourceItem } from "./CanvasResourceItem";
import { ConnectionLinesLayer } from "./ConnectionLinesLayer";

export const CanvasBoard = memo(function CanvasBoard() {
  const resources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const scale = useCanvasStore((s) => s.scale);
  const translateX = useCanvasStore((s) => s.translateX);
  const translateY = useCanvasStore((s) => s.translateY);
  const setSelectedResourceForConfigId = useCanvasStore((s) => s.setSelectedResourceForConfigId);

  const {
    handleDeleteCanvasResource,
    handleMoveCanvasResource,
    commitMoveCanvasResource,
    handleDeleteConnectionLine,
  } = useCanvasResourceActions();
  const { hanldeResouceClick } = useCanvasConnectionActions();
  const viewport = useCanvasViewport();

  const { setNodeRef } = useDroppable({ id: "canvas" });

  return (
    <div
      id="canvas"
      ref={(el) => {
        setNodeRef(el);
        viewport.containerRef.current = el;
      }}
      className="flex-1 h-full relative overflow-hidden"
      style={{
        // Dot grid scales + pans with the viewport so the whole canvas feels alive.
        backgroundImage: `radial-gradient(circle, #1e293b 1px, transparent 1px)`,
        backgroundSize: `${24 * scale}px ${24 * scale}px`,
        backgroundPosition: `${translateX}px ${translateY}px`,
      }}
      onPointerDown={viewport.handlePanStart}
      onPointerMove={viewport.handlePanMove}
      onPointerUp={viewport.handlePanEnd}
      onClick={(e) => {
        // Deselect a connection only when the empty canvas itself is clicked.
        if (e.target === e.currentTarget) {
          useCanvasStore.getState().setSelectedConnectionId(null);
        }
      }}
    >
      {/* Transformed "world" layer. pointer-events: none so pan/click fall through
          to the outer canvas; individual resource items re-enable pointer events. */}
      <div
        style={{
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          transformOrigin: "0 0",
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        <ConnectionLinesLayer
          resources={resources}
          connectionLines={connectionLines}
          onDeleteConnection={handleDeleteConnectionLine}
          scale={scale}
        />
        {resources.map((resource) => (
          <CanvasResourceItem
            key={resource.id}
            resource={resource}
            scale={scale}
            onResourceClick={hanldeResouceClick}
            onResourceDoubleClick={setSelectedResourceForConfigId}
            onDeleteResource={handleDeleteCanvasResource}
            onMoveResource={handleMoveCanvasResource}
            onCommitMove={commitMoveCanvasResource}
          />
        ))}
      </div>
    </div>
  );
});