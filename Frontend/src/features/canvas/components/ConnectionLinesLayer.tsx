import { memo } from "react";
import { BezierConnectionLine } from "./BezierConnectionLine";
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
  const liveMode = useCanvasStore((s) => s.liveMode);
  // Boolean selectors: stable across 1Hz snapshots, no extra re-renders.
  const simulationRunning = useSimulationStore(
    (s) => s.simulatedSeconds > 0 && s.speed > 0
  );

  return (
    // z-0: committed tubes always paint BELOW every card wrapper (z-10),
    // matching react-flow-style edge-under-node stacking. The pending
    // drag line moved to PendingConnectionLayer (z-20, above everything).
    <svg
      className="absolute inset-0 pointer-events-none z-0"
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
            showPackets={liveMode}
            animatePackets={simulationRunning}
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