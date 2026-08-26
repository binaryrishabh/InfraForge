import { toast } from "sonner";
import type { Resource } from "@shared/types/Resource.types";
import type { ConnectionLine } from "@shared/types/ConnectionLine.types";
import type { UndoCanvasResourceAction } from "@shared/types/UndoCanvasResourceAction.types";
import type { RefObject } from "react";

interface UseCanvasResourceActionsProps {
  isDeploying: boolean;
  canvasResources: Resource[];
  connectionLines: ConnectionLine[];
  currentLayoutSaved: boolean;
  setCanvasResources: React.Dispatch<React.SetStateAction<Resource[]>>;
  setConnectionLines: React.Dispatch<React.SetStateAction<ConnectionLine[]>>;
  setCurrentLayoutSaved: (saved: boolean) => void;
  setUndoResourcesSnapshotStackTrace: React.Dispatch<
    React.SetStateAction<UndoCanvasResourceAction[]>
  >;
  setRedoResourcesSnapshotStackTrace: (
    stack: UndoCanvasResourceAction[],
  ) => void;
  handleUndoRef: RefObject<() => void>;
}

export function useCanvasResourceActions({
  isDeploying,
  canvasResources,
  connectionLines,
  currentLayoutSaved,
  setCanvasResources,
  setConnectionLines,
  setCurrentLayoutSaved,
  setUndoResourcesSnapshotStackTrace,
  setRedoResourcesSnapshotStackTrace,
  handleUndoRef,
}: UseCanvasResourceActionsProps) {
  /* ----------------------Canvas Resources------------------ */
  // Delete canvas resource
  const handleDeleteCanvasResource = (resourceId: string) => {
    if (isDeploying) {
      // Deployement already in process
      toast.warning("A deployment is in progress. Can't select");
      return;
    }
    // Find particular resource on the canvas whse resourceId has been passed.
    const resource = canvasResources.find(
      (canvasResource) => canvasResource.id === resourceId,
    );
    // Find the resource whose resourceId has been passed and has any connection or not...
    const touchingConnections = connectionLines.filter(
      (connectionLine) =>
        connectionLine.sourceId === resourceId ||
        connectionLine.targetId === resourceId,
    );
    // Add the deleted resource to the undoStack so that future undo could be done...
    if (resource) {
      setUndoResourcesSnapshotStackTrace((prev) => [
        ...prev,
        {
          type: "delete",
          resource,
          connectionLines: touchingConnections,
          savedState: currentLayoutSaved,
        },
      ]);
      setRedoResourcesSnapshotStackTrace([]);
    }
    // Delete resource
    setCanvasResources((prev) =>
      prev.filter((resource) => resource.id !== resourceId),
    );
    // Delete connectionLines touching this resource (fixes dangling connections)
    setConnectionLines((prev) =>
      prev.filter(
        (connectionLine) =>
          connectionLine.sourceId !== resourceId &&
          connectionLine.targetId !== resourceId,
      ),
    );
    setCurrentLayoutSaved(false);
    // Undo toast
    toast("Resource deleted", {
      action: {
        label: "Undo",
        onClick: () => handleUndoRef.current(), // Use ref to avaoid stale state
      },
      duration: 5000,
    });
  };

  // Update a canvas resource in place (e.g. assign a provider SKU)
  const handleUpdateCanvasResource = (
    resourceId: string,
    patch: Partial<Resource>,
  ) => {
    if (isDeploying) {
      toast.warning("A deployment is in progress. Can't modify");
      return;
    }
    setCanvasResources((prev) =>
      prev.map((r) => (r.id === resourceId ? { ...r, ...patch } : r)),
    );
    setCurrentLayoutSaved(false);
  };

  return {
    handleDeleteCanvasResource,
    handleUpdateCanvasResource,
  };
}
