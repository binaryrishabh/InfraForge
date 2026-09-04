import { memo } from "react";
import { BezierConnectionLine } from "./BezierConnectionLine";
import { useCanvasStore } from "../store/canvasStore";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Resource } from "@shared/interface/Resource.interface";

interface ConnectionLinesLayerProps {
  resources: Resource[];
  connectionLines: ConnectionLine[];
  onDeleteConnection: (connectionId: string) => void;
  scale: number;
}

export const ConnectionLinesLayer = memo(function ConnectionLinesLayer({
  resources,
  connectionLines,
  onDeleteConnection,
  scale,
}: ConnectionLinesLayerProps) {
  const selectedConnectionId = useCanvasStore((s) => s.selectedConnectionId);

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-10"
      width="100%"
      height="100%"
      style={{ overflow: "visible" }}
    >
      {connectionLines.map((connectionLine) => {
        const source = resources.find(
          (resource) => resource.id === connectionLine.sourceId
        );
        const target = resources.find(
          (resource) => resource.id === connectionLine.targetId
        );
        if (!source || !target) {
          return null;
        }
        const isSelected = selectedConnectionId === connectionLine.id;
        return (
          <BezierConnectionLine
            key={connectionLine.id}
            source={source}
            target={target}
            port={connectionLine.port}
            isSelected={isSelected}
            scale={scale}
            onSelect={() =>
              isSelected
                ? onDeleteConnection(connectionLine.id)
                : useCanvasStore.getState().setSelectedConnectionId(connectionLine.id)
            }
          />
        );
      })}
    </svg>
  );
});