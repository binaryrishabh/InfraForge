import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { CanvasResourceItem } from "./CanvasResourceItem";
import { ConnectionLinesLayer } from "./ConnectionLinesLayer";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

export interface CanvasBoardProps {
  resources: Array<Resource>;
  onDeleteResource: (itemId: string) => void;
  onResourceClick: (resourceId: string, resourceType: ResourceType) => void;
  connectionLines: Array<ConnectionLine>;
  onResourceDoubleClick: (resourceId: string) => void;
}

export const CanvasBoard = memo(function CanvasBoard({
  resources,
  onDeleteResource,
  onResourceClick,
  connectionLines,
  onResourceDoubleClick,
}: CanvasBoardProps) {
  const { setNodeRef } = useDroppable({
    id: "canvas",
  });

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
      <ConnectionLinesLayer
        resources={resources}
        connectionLines={connectionLines}
      />
      {resources.map((resource) => (
        <CanvasResourceItem
          key={resource.id}
          resource={resource}
          onResourceClick={onResourceClick}
          onResourceDoubleClick={onResourceDoubleClick}
          onDeleteResource={onDeleteResource}
        />
      ))}
    </div>
  );
});