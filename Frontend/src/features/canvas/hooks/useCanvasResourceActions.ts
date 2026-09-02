import { useCallback } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
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
  setCanvasResources,
  setConnectionLines,
  setCurrentLayoutSaved,
  setUndoResourcesSnapshotStackTrace,
  setRedoResourcesSnapshotStackTrace,
  handleUndoRef,
}: UseCanvasResourceActionsProps) {
  /* ----------------------Canvas Resources------------------ */
  // Delete canvas resource.
  // Stable identity (useCallback + []) so CanvasResourceItem's memo can skip
  // repaints — live values are read from the store at call time instead of
  // from render-scope props.
  const handleDeleteCanvasResource = useCallback((resourceId: string) => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) {
      // Deployement already in process
      toast.warning("A deployment is in progress. Can't select");
      return;
    }
    // Find particular resource on the canvas whse resourceId has been passed.
    const resource = store.resources.find(
      (canvasResource) => canvasResource.id === resourceId,
    );
    // Find the resource whose resourceId has been passed and has any connection or not...
    const touchingConnections = store.connectionLines.filter(
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
          savedState: store.currentLayoutSaved,
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
  }, []);

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