import { memo } from "react";
import { BezierConnectionLine } from "./BezierConnectionLine";
import { PendingConnectionLine } from "./PendingConnectionLine";
import { useCanvasStore } from "../store/canvasStore";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";
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
  const pendingConnection = useCanvasStore((s) => s.pendingConnection);
  // Packets flow only while a simulation is actually ticking (live + not paused).
  const flow = useSimulationStore((s) => s.simulatedSeconds > 0 && s.speed > 0);

  const pendingSource = pendingConnection
    ? resources.find((r) => r.id === pendingConnection.sourceId)
    : null;

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
            nodeWidth={NODE_CARD_WIDTH}
            nodeHeight={NODE_CARD_HEIGHT}
            flow={flow}
            onSelect={() =>
              isSelected
                ? onDeleteConnection(connectionLine.id)
                : useCanvasStore.getState().setSelectedConnectionId(connectionLine.id)
            }
          />
        );
      })}
      {pendingConnection && pendingSource && (
        <PendingConnectionLine
          source={{ x: pendingSource.x, y: pendingSource.y }}
          cursor={{ x: pendingConnection.cursorX, y: pendingConnection.cursorY }}
        />
      )}
    </svg>
  );
});