import { memo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import {
  MonitoringDashboardCard,
  NODE_CARD_WIDTH,
} from "@/features/monitoring/components/MonitoringDashboardCard";
import { positionIsOccupied } from "../utils/cardFootprint";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";

const GRID_SIZE = 24;

interface ReplicaCardProps {
  replicaId: string;
  x: number;
  y: number;
}

/* An autoscaled replica rendered as a REAL canvas node: draggable with grid
snap, blocked by (and blocking) every other card through the shared overlap
guard, removed by the engine on drain — no ports, no delete chip, because
descale is the only honest way to retire a replica. */
export const ReplicaCard = memo(function ReplicaCard({ replicaId, x, y }: ReplicaCardProps) {
  const dragRef = useRef<{
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const canvas = document.getElementById("canvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, translateX, translateY } = useCanvasStore.getState();
    const canvasX = (e.clientX - rect.left - translateX) / scale;
    const canvasY = (e.clientY - rect.top - translateY) / scale;
    dragRef.current = { offsetX: canvasX - x, offsetY: canvasY - y, startX: x, startY: y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const canvas = document.getElementById("canvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, translateX, translateY } = useCanvasStore.getState();
    const canvasX = (e.clientX - rect.left - translateX) / scale;
    const canvasY = (e.clientY - rect.top - translateY) / scale;
    useCanvasStore
      .getState()
      .setReplicaPosition(replicaId, canvasX - drag.offsetX, canvasY - drag.offsetY);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const store = useCanvasStore.getState();
    const current = store.replicaPositions[replicaId];
    if (!current) return;
    const snappedX = Math.round(current.x / GRID_SIZE) * GRID_SIZE;
    const snappedY = Math.round(current.y / GRID_SIZE) * GRID_SIZE;
    // Replicas occupy space like real nodes: canvas cards AND other replicas
    // are obstacles; the dragged replica ignores only itself.
    const obstacles = [
      ...store.resources.map((r) => ({ id: r.id, x: r.x, y: r.y })),
      ...Object.entries(store.replicaPositions).map(([id, pos]) => ({ id, x: pos.x, y: pos.y })),
    ];
    if (positionIsOccupied(obstacles, snappedX, snappedY, replicaId)) {
      store.setReplicaPosition(replicaId, drag.startX, drag.startY);
      toast.warning("Space already occupied!");
      return;
    }
    store.setReplicaPosition(replicaId, snappedX, snappedY);
  };

  return (
    <div
      className="absolute group rounded-xl pointer-events-auto cursor-grab active:cursor-grabbing select-none z-10"
      style={{ left: x, top: y, width: NODE_CARD_WIDTH }}
      title={replicaId}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <MonitoringDashboardCard
        mode="live"
        asContent
        resource={{
          id: replicaId,
          type: RESOURCE_TYPES.VirtualMachine,
          x,
          y,
        }}
      />
    </div>
  );
});