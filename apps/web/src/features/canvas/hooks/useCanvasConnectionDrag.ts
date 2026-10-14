import { useEffect } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { connectResources } from "../actions";
import type { ResourceType } from "@infraforge/domain/resource";

/* clientX/clientY are the port dot's center (sent by CanvasResourcePorts),
   so the pending line's anchor lands exactly on the card edge. */
export function startConnectionFromPort(
  sourceId: string,
  sourceType: ResourceType,
  clientX: number,
  clientY: number
) {
  const store = useCanvasStore.getState();
  if (store.liveLocked || store.isDeploying) return;
  const canvas = document.getElementById("canvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const { scale, translateX, translateY } = store;
  const x = (clientX - rect.left - translateX) / scale;
  const y = (clientY - rect.top - translateY) / scale;
  store.startPendingConnection(sourceId, sourceType, x, y);
}

export function useCanvasConnectionDrag() {
  const pendingConnection = useCanvasStore((s) => s.pendingConnection);

  useEffect(() => {
    if (!pendingConnection) return;

    const handlePointerMove = (e: PointerEvent) => {
      const store = useCanvasStore.getState();
      const canvas = document.getElementById("canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { scale, translateX, translateY } = store;
      const x = (e.clientX - rect.left - translateX) / scale;
      const y = (e.clientY - rect.top - translateY) / scale;
      store.movePendingConnection(x, y);
    };

    const handlePointerUp = (e: PointerEvent) => {
      finalizeConnection(e.clientX, e.clientY);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        useCanvasStore.getState().cancelPendingConnection();
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pendingConnection]);
}

function finalizeConnection(clientX: number, clientY: number) {
  const store = useCanvasStore.getState();
  const pending = store.pendingConnection;
  store.cancelPendingConnection();
  if (!pending) return;
  const targetId = document.elementFromPoint(clientX, clientY)?.closest("[data-resource-id]")?.getAttribute("data-resource-id");
  // Releasing over empty space or the source itself cancels quietly.
  if (!targetId || targetId === pending.sourceId) return;
  connectResources(pending.sourceId, targetId);
}
