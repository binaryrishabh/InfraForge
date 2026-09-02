import { useCallback } from "react";
import { toast } from "sonner";
import { validateConnection } from "@shared/validation/validateDeploymentReadiness.validation";
import { RESOURCE_PORTS } from "@shared/constants/RESOURCE_PORTS.constants";
import { useCanvasStore } from "../store/canvasStore";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

// Actions-only variant of useCanvasConnections: NO store subscriptions, so
// components that only need the handlers never re-render from connection state.
// All live values are read via useCanvasStore.getState() at call time.
// NOTE: hanldeResouceClick keeps its existing (misspelled) name deliberately
// so no consumer file has to change.
export function useCanvasConnectionActions() {
  const hanldeResouceClick = useCallback((resourceId: string, resourceType: ResourceType) => {
    const store = useCanvasStore.getState();
    if (!store.isConnecting) return;
    const selectedResourceId = store.selectedResourceId;
    if (!selectedResourceId) {
      store.setSelectedResourceId(resourceId);
    } else if (selectedResourceId === resourceId) {
      store.setSelectedResourceId(null);
    } else {
      const alreadyConnectionLineExists = store.connectionLines.some(
        (line) => line.sourceId === selectedResourceId && line.targetId === resourceId
      );
      if (alreadyConnectionLineExists) { toast.warning("Connection already exists!"); store.setSelectedResourceId(null); return; }
      const sourceItem = store.resources.find((r) => r.id === selectedResourceId);
      if (!sourceItem) return;
      const validConnection = validateConnection(sourceItem.type, resourceType);
      if (!validConnection.valid) { toast.warning(validConnection.message); store.setSelectedResourceId(null); return; }
      const port = RESOURCE_PORTS[sourceItem.type] || 80;
      store.setCurrentLayoutSaved(false);
      store.setConnectionLines((prev) => [
        ...prev, { id: `connection-${Date.now()}`, sourceId: selectedResourceId, targetId: resourceId, sourceType: sourceItem.type, targetType: resourceType, port },
      ]);
      store.setRedoStack([]);
      store.setSelectedResourceId(null);
    }
  }, []);

  const handleToggleConnectionLines = useCallback(() => {
    const store = useCanvasStore.getState();
    store.setIsConnecting(!store.isConnecting);
    store.setSelectedResourceId(null);
  }, []);

  return { hanldeResouceClick, handleToggleConnectionLines };
}