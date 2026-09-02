import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useCanvasStore } from "../store/canvasStore";
import { useCanvasResourceActions } from "../hooks/useCanvasResourceActions";
import { useCanvasConnectionActions } from "../hooks/useCanvasConnectionActions";
import { CanvasResourceItem } from "./CanvasResourceItem";
import { ConnectionLinesLayer } from "./ConnectionLinesLayer";

export const CanvasBoard = memo(function CanvasBoard() {
  const resources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const setSelectedResourceForConfigId = useCanvasStore((s) => s.setSelectedResourceForConfigId);

  const { handleDeleteCanvasResource } = useCanvasResourceActions();
  const { hanldeResouceClick } = useCanvasConnectionActions();

  const { setNodeRef } = useDroppable({ id: "canvas" });

  return (
    <div
      id="canvas"
      ref={setNodeRef}
      className="flex-1 h-full relative"
      style={{
        backgroundImage: `radial-gradient(circle, #1e293b 1px, transparent 1px)`,
        backgroundSize: "24px 24px",
      }}
    >
      <ConnectionLinesLayer resources={resources} connectionLines={connectionLines} />
      {resources.map((resource) => (
        <CanvasResourceItem
          key={resource.id}
          resource={resource}
          onResourceClick={hanldeResouceClick}
          onResourceDoubleClick={setSelectedResourceForConfigId}
          onDeleteResource={handleDeleteCanvasResource}
        />
      ))}
    </div>
  );
});