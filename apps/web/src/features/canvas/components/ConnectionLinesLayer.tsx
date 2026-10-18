import { memo } from "react";
import type { ConnectionLine, Resource } from "@infraforge/domain/resource";
import { RailConnection } from "./RailConnection";
import { useCanvasStore } from "../store/canvasStore";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { NODE_CARD_WIDTH, NODE_CARD_HEIGHT, DESIGN_CARD_HEIGHT } from "../utils/nodeGeometry";
import { deleteConnection } from "../actions";

/* Committed connections paint under every card. Clicking selects; removal is an
explicit button (or Delete), never a second click. */
export const ConnectionLinesLayer = memo(function ConnectionLinesLayer({ resources, connectionLines, scale }: { resources: Resource[]; connectionLines: ConnectionLine[]; scale: number }) {
  const selectedConnectionId = useCanvasStore((s) => s.selectedConnectionId);
  const liveMode = useCanvasStore((s) => s.liveMode);
  const locked = useCanvasStore((s) => s.liveLocked || s.isDeploying);
  const cardHeights = useCanvasStore((s) => s.cardHeights);
  const metrics = useSimulationStore((s) => (liveMode ? s.metrics : null));
  const nodeHeight = liveMode ? NODE_CARD_HEIGHT : DESIGN_CARD_HEIGHT;
  const byId = new Map(resources.map((r) => [r.id, r]));
  return (
    <svg className="pointer-events-none absolute inset-0 z-0" width="100%" height="100%" style={{ overflow: "visible" }}>
      {connectionLines.map((line) => {
        const source = byId.get(line.sourceId), target = byId.get(line.targetId);
        if (!source || !target) return null;
        const selected = selectedConnectionId === line.id;
        // Qualitative only: a line takes the health recorded for the resource it feeds. Model 1 records no
        // per-connection traffic, so nothing moves along the rails.
        const health = metrics?.[target.id]?.health;
        const tone = health === "failed" || health === "saturated" ? "fail" : health === "degraded" ? "warn" : null;
        return (
          <RailConnection key={line.id} source={source} target={target} port={line.port} isSelected={selected} scale={scale}
            nodeWidth={NODE_CARD_WIDTH} sourceHeight={cardHeights[source.id] ?? nodeHeight} targetHeight={cardHeights[target.id] ?? nodeHeight}
            tone={tone} label={`${source.name || source.id} to ${target.name || target.id}`}
            onSelect={() => { const store = useCanvasStore.getState(); store.setSelectedConnectionId(selected ? null : line.id); store.setSelectedResourceId(null); }}
            onRemove={locked ? undefined : () => deleteConnection(line.id)} />
        );
      })}
    </svg>
  );
});
