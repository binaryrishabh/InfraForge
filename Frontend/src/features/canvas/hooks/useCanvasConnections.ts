import { useCallback } from "react";
import { toast } from "sonner";
import { validateConnection } from "@shared/validation/validateDeploymentReadiness.validation";
import { RESOURCE_PORTS } from "@shared/constants/RESOURCE_PORTS.constants";
import { useCanvasStore } from "../store/canvasStore";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";
import type { UndoCanvasResourceAction } from "@shared/types/UndoCanvasResourceAction.types";

interface UseCanvasConnectionsProps {
  canvasResources: Resource[];
  setCurrentLayoutSaved: (saved: boolean) => void;
  setRedoResourcesSnapshotStackTrace: (stack: UndoCanvasResourceAction[]) => void;
}

export function useCanvasConnections({
  setCurrentLayoutSaved,
  setRedoResourcesSnapshotStackTrace,
}: UseCanvasConnectionsProps) {
  /* ----------------------CONNECTION LINES BETWEEN RESOURCES ON CANVAS------------------ */
  // Single source of truth: connection lines, the selected source, and the connecting
  // flag all live in useCanvasStore now — no local useState copies.
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const selectedResource = useCanvasStore((s) => s.selectedResourceId);
  const isConnecting = useCanvasStore((s) => s.isConnecting);

  // Form connection line between 2 resources.
  // Stable identity (useCallback + []) so CanvasResourceItem's memo can skip
  // repaints — everything, including the source lookup, is read from the store
  // at call time.
  const hanldeResouceClick = useCallback((resourceId: string, resourceType: ResourceType) => {
    const store = useCanvasStore.getState();
    if (!store.isConnecting) {
      return;
    }
    // Capture once so the string | null narrowing survives the intervening calls below
    const selectedResourceId = store.selectedResourceId;
    if (!selectedResourceId) {
      store.setSelectedResourceId(resourceId);
    }
    else if (selectedResourceId === resourceId) { // making connection with the resource itself
      store.setSelectedResourceId(null); // Deselect
    }
    else { // create connection
      const alreadyConnectionLineExists = store.connectionLines.some(
        connectionLine => connectionLine.sourceId === selectedResourceId && connectionLine.targetId === resourceId
      )
      if (alreadyConnectionLineExists) {
        toast.warning("Connection already exists!");
        store.setSelectedResourceId(null);
        return;
      }
      const sourceItem = store.resources.find(resource => resource.id === selectedResourceId);
      if (!sourceItem) {
        return;
      }
      const validConnection = validateConnection(sourceItem.type, resourceType);
      if (!validConnection.valid) { // Check even connection is valid or not
        toast.warning(validConnection.message);
        store.setSelectedResourceId(null);
        return;
      }
      if (sourceItem) {
        const port = RESOURCE_PORTS[sourceItem.type] || 80;
        setCurrentLayoutSaved(false);
        store.setConnectionLines(prev => [...prev, {
          id: `connection-${Date.now()}`,
          sourceId: selectedResourceId,
          targetId: resourceId,
          sourceType: sourceItem.type,
          targetType: resourceType,
          port
        }])
        // Clear the redo stack when modifying the canvas timeline with adding new connection lines...
        setRedoResourcesSnapshotStackTrace([]);
        // Push the new connection line to the stack in Phase-5
      }
      store.setSelectedResourceId(null);
    }
  }, []);

  const handleToggleConnectionLines = () => {
    const store = useCanvasStore.getState();
    store.setIsConnecting(!store.isConnecting);
    store.setSelectedResourceId(null);
  }

  return {
    connectionLines,
    selectedResource,
    isConnecting,
    hanldeResouceClick,
    handleToggleConnectionLines,
  };
}