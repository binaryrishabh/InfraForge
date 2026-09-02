import { memo } from "react";
import { BezierConnectionLine } from "./BezierConnectionLine";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Resource } from "@shared/interface/Resource.interface";

interface ConnectionLinesLayerProps {
  resources: Resource[];
  connectionLines: ConnectionLine[];
}

export const ConnectionLinesLayer = memo(function ConnectionLinesLayer({
  resources,
  connectionLines,
}: ConnectionLinesLayerProps) {
  return (
    <svg
      className="absolute inset-0 pointer-events-none z-10"
      width="100%"
      height="100%"
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
        return (
          <BezierConnectionLine
            key={connectionLine.id}
            source={source}
            target={target}
            port={connectionLine.port}
          />
        );
      })}
    </svg>
  );
});