import { useEffect } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import { validateConnection } from "@shared/validation/validateDeploymentReadiness.validation";
import { RESOURCE_PORTS } from "@shared/constants/RESOURCE_PORTS.constants";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

export function startConnectionFromPort(
  sourceId: string,
  sourceType: ResourceType,
  clientX: number,
  clientY: number
) {
  const store = useCanvasStore.getState();
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

  const targetElement = document.elementFromPoint(clientX, clientY);
  const targetNode = targetElement?.closest("[data-resource-id]");

  if (!targetNode) return; // empty space: silent cancel

  const targetId = targetNode.getAttribute("data-resource-id");
  if (!targetId || targetId === pending.sourceId) return; // self: silent

  const targetResource = store.resources.find((r) => r.id === targetId);
  if (!targetResource) return;

  const duplicate = store.connectionLines.some(
    (l) => l.sourceId === pending.sourceId && l.targetId === targetId
  );
  if (duplicate) {
    toast.warning("Connection already exists!");
    return;
  }

  const verdict = validateConnection(pending.sourceType, targetResource.type);
  if (!verdict.valid) {
    toast.warning(verdict.message);
    return;
  }

  const port = RESOURCE_PORTS[targetResource.type] || 80;

  store.setConnectionLines((prev) => [
    ...prev,
    {
      id: `connection-${Date.now()}`,
      sourceId: pending.sourceId,
      targetId,
      sourceType: pending.sourceType,
      targetType: targetResource.type,
      port,
    },
  ]);
  store.setRedoStack([]);
  store.setCurrentLayoutSaved(false);
}