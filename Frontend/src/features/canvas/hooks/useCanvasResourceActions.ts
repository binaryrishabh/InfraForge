import { useCallback } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import type { Resource } from "@shared/interface/Resource.interface";

export function useCanvasResourceActions() {
  const performUndo = useCallback(() => {
    const store = useCanvasStore.getState();
    if (store.isDeploying || store.undoStack.length === 0) return;
    const last = store.undoStack[store.undoStack.length - 1];
    if (!last) return;
    if (last.type === "add") {
      store.setResources(prev => prev.filter(r => r.id !== last.resource.id));
      store.setConnectionLines(prev => prev.filter(l => l.sourceId !== last.resource.id && l.targetId !== last.resource.id));
      store.setCurrentLayoutSaved(last.savedState);
    } else if (last.type === "delete") {
      store.setResources(prev => [...prev, last.resource]);
      store.setConnectionLines(prev => [...prev, ...last.connectionLines]);
      store.setCurrentLayoutSaved(last.savedState);
    } else if (last.type === "move") {
      store.setResources(prev => prev.map(r => r.id === last.resourceId ? { ...r, x: last.fromX, y: last.fromY } : r));
      store.setCurrentLayoutSaved(last.savedState);
    } else if (last.type === "delete-connection") {
      store.setConnectionLines(prev => [...prev, last.connectionLine]);
      store.setCurrentLayoutSaved(last.savedState);
    }
    store.setUndoStack(prev => prev.slice(0, -1));
    store.setRedoStack(prev => [...prev, last]);
    toast.success("Undo");
  }, []);

  const handleDeleteCanvasResource = useCallback((resourceId: string) => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) { toast.warning("A deployment is in progress. Can't select"); return; }
    const resource = store.resources.find((r) => r.id === resourceId);
    const touchingConnections = store.connectionLines.filter(
      (line) => line.sourceId === resourceId || line.targetId === resourceId,
    );
    if (resource) {
      store.setUndoStack((prev) => [
        ...prev, { type: "delete", resource, connectionLines: touchingConnections, savedState: store.currentLayoutSaved },
      ]);
      store.setRedoStack([]);
    }
    store.setResources((prev) => prev.filter((r) => r.id !== resourceId));
    store.setConnectionLines((prev) => prev.filter((line) => line.sourceId !== resourceId && line.targetId !== resourceId));
    store.setCurrentLayoutSaved(false);
    toast("Resource deleted", { action: { label: "Undo", onClick: performUndo }, duration: 5000 });
  }, [performUndo]);

  const handleUpdateCanvasResource = useCallback((resourceId: string, patch: Partial<Resource>) => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) { toast.warning("A deployment is in progress. Can't modify"); return; }
    store.setResources((prev) => prev.map((r) => (r.id === resourceId ? { ...r, ...patch } : r)));
    store.setCurrentLayoutSaved(false);
  }, []);

  // Live drag feedback — called on every pointermove. Deliberately does NOT touch
  // the undo stack or the saved flag; that only happens once in commitMove.
  const handleMoveCanvasResource = useCallback((resourceId: string, x: number, y: number) => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) return;
    store.setResources(prev => prev.map(r => r.id === resourceId ? { ...r, x, y } : r));
  }, []);

  // Called once on drag release. Records the move for undo/redo and marks dirty.
  const commitMoveCanvasResource = useCallback((resourceId: string, fromX: number, fromY: number, toX: number, toY: number) => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) return;
    if (fromX === toX && fromY === toY) return;
    // Overlap prevention: reject the drop if the destination collides with another
    // resource, and snap the node back to where the drag started. Same 40px
    // threshold as the sidebar-drop guard.
    const isOverlapping = store.resources.some(
      (r) => r.id !== resourceId && Math.abs(r.x - toX) < 40 && Math.abs(r.y - toY) < 40,
    );
    if (isOverlapping) {
      store.setResources(prev => prev.map(r => r.id === resourceId ? { ...r, x: fromX, y: fromY } : r));
      toast.warning("Space already occupied!");
      return;
    }
    store.setUndoStack(prev => [...prev, {
      type: "move",
      resourceId,
      fromX,
      fromY,
      toX,
      toY,
      savedState: store.currentLayoutSaved,
    }]);
    store.setRedoStack([]);
    store.setCurrentLayoutSaved(false);
  }, []);

  // Delete a single connection line by id, with undo support.
  const handleDeleteConnectionLine = useCallback((connectionId: string) => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) { toast.warning("A deployment is in progress. Can't modify"); return; }
    const line = store.connectionLines.find((l) => l.id === connectionId);
    if (!line) return;
    store.setUndoStack((prev) => [
      ...prev, { type: "delete-connection", connectionLine: line, savedState: store.currentLayoutSaved },
    ]);
    store.setRedoStack([]);
    store.setConnectionLines((prev) => prev.filter((l) => l.id !== connectionId));
    store.setSelectedConnectionId(null);
    store.setCurrentLayoutSaved(false);
    toast("Connection removed", { action: { label: "Undo", onClick: performUndo }, duration: 5000 });
  }, [performUndo]);

  return {
    handleDeleteCanvasResource,
    handleUpdateCanvasResource,
    handleMoveCanvasResource,
    commitMoveCanvasResource,
    handleDeleteConnectionLine,
  };
}