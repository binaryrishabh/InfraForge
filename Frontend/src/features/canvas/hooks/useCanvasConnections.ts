import { useState } from "react";
import { toast } from "sonner";
import { validateConnection } from "@shared/validation/validateDeploymentReadiness.validation";
import { RESOURCE_PORTS } from "@shared/constants/RESOURCE_PORTS.constants";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";
import type { UndoCanvasResourceAction } from "@shared/types/UndoCanvasResourceAction.types";

interface UseCanvasConnectionsProps {
  canvasResources: Resource[];
  setCurrentLayoutSaved: (saved: boolean) => void;
  setRedoResourcesSnapshotStackTrace: (stack: UndoCanvasResourceAction[]) => void;
}

export function useCanvasConnections({
  canvasResources,
  setCurrentLayoutSaved,
  setRedoResourcesSnapshotStackTrace,
}: UseCanvasConnectionsProps) {
  /* ----------------------CONNECTION LINES BETWEEN RESOURCES ON CANVAS------------------ */
  // state of connection lines/grids between the resources on canvas...
  const [connectionLines, setConnectionLines] = useState<Array<ConnectionLine>>([]);
  const [selectedResource, setSelectedResource] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  // Form connection line between 2 resources
  const hanldeResouceClick = (resourceId: string, resourceType: ResourceType) => {
    if (!isConnecting) {
      return;
    }

    if (!selectedResource) {
      setSelectedResource(resourceId);
    }
    else if (selectedResource === resourceId) { // making connection with the resource itself
      setSelectedResource(null); // Deselect
    }
    else { // create connection      
      const alreadyConnectionLineExists = connectionLines.some(
        connectionLine => connectionLine.sourceId === selectedResource && connectionLine.targetId === resourceId
      )

      if (alreadyConnectionLineExists) {
        toast.warning("Connection already exists!");
        setSelectedResource(null);
        return;
      }

      const sourceItem = canvasResources.find(resource => resource.id === selectedResource);

      if (!sourceItem) {
        return;
      }

      const validConnection = validateConnection(sourceItem.type, resourceType);

      if (!validConnection.valid) { // Check even connection is valid or not
        toast.warning(validConnection.message);
        setSelectedResource(null);
        return;
      }

      if (sourceItem) {
        const port = RESOURCE_PORTS[sourceItem.type] || 80;

        setCurrentLayoutSaved(false);

        setConnectionLines(prev => [...prev, {
          id: `connection-${Date.now()}`,
          sourceId: selectedResource,
          targetId: resourceId,
          sourceType: sourceItem.type,
          targetType: resourceType,
          port
        }])

        // Clear the redo stack when modifying the canvas timeline with adding new connection lines...
        setRedoResourcesSnapshotStackTrace([]);

        // Push the new connection line to the stack in Phase-5
      }
      setSelectedResource(null);
    }
  }

  const handleToggleConnectionLines = () => {
    setIsConnecting(!isConnecting);
    setSelectedResource(null);
  }

  return {
    connectionLines,
    setConnectionLines,
    selectedResource,
    setSelectedResource,
    isConnecting,
    setIsConnecting,
    hanldeResouceClick,
    handleToggleConnectionLines,
  };
}