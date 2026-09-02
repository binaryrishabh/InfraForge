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
    } else {
      store.setResources(prev => [...prev, last.resource]);
      store.setConnectionLines(prev => [...prev, ...last.connectionLines]);
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

  return { handleDeleteCanvasResource, handleUpdateCanvasResource };
}