import { memo } from "react";
import { PendingConnectionLine } from "./PendingConnectionLine";
import { useCanvasStore } from "../store/canvasStore";

/* The in-flight drag-to-connect line lives in its own top-most layer inside
   the world transform. Card wrappers sit at z-10 (ports contained inside
   them), so z-20 here guarantees the pending line draws over every node
   while the drag is in flight. Renders nothing when idle. */
export const PendingConnectionLayer = memo(function PendingConnectionLayer() {
  const pendingConnection = useCanvasStore((s) => s.pendingConnection);
  const resources = useCanvasStore((s) => s.resources);

  if (!pendingConnection) return null;
  const source = resources.find((r) => r.id === pendingConnection.sourceId);
  if (!source) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-20"
      width="100%"
      height="100%"
      style={{ overflow: "visible" }}
    >
      <PendingConnectionLine
        source={{ x: pendingConnection.anchorX, y: pendingConnection.anchorY }}
        cursor={{ x: pendingConnection.cursorX, y: pendingConnection.cursorY }}
      />
    </svg>
  );
});