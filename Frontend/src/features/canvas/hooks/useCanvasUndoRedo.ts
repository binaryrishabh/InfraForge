import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";

export function useCanvasUndoRedo() {
  const handleUndoResource = () => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) {
      toast.warning("Can't undo or redo as deployemnt is in process");
      return;
    }
    if (store.undoStack.length === 0) return;

    const last = store.undoStack[store.undoStack.length - 1];
    if (!last) return;

    if (last.type === "add") {
      store.setResources(prev => prev.filter(r => r.id !== last.resource.id));
      store.setConnectionLines(prev => prev.filter(l => l.sourceId !== last.resource.id && l.targetId !== last.resource.id));
      store.setCurrentLayoutSaved(last.savedState);
    } else {
      const occupied = store.resources.some(
        r => Math.abs(r.x - last.resource.x) < 40 && Math.abs(r.y - last.resource.y) < 40
      );
      if (occupied) {
        toast.warning("Can't undo - that spot is now occupied");
        store.setUndoStack(prev => prev.slice(0, -1));
        return;
      }
      store.setResources(prev => [...prev, last.resource]);
      store.setConnectionLines(prev => [...prev, ...last.connectionLines]);
      store.setCurrentLayoutSaved(last.savedState);
    }
    store.setUndoStack(prev => prev.slice(0, -1));
    store.setRedoStack(prev => [...prev, last]);
    toast.success("Undo");
  };

  const handleRedoResource = () => {
    const store = useCanvasStore.getState();
    if (store.isDeploying) {
      toast.warning("Can't undo or redo as deployemnt is in process");
      return;
    }
    if (store.redoStack.length === 0) return;

    const last = store.redoStack[store.redoStack.length - 1];
    if (last.type === "add") {
      store.setResources(prev => [...prev, last.resource]);
      store.setConnectionLines(prev => [...prev, ...last.connectionLines]);
    } else {
      store.setResources(prev => prev.filter(r => r.id !== last.resource.id));
      store.setConnectionLines(prev => prev.filter(l => l.sourceId !== last.resource.id && l.targetId !== last.resource.id));
    }
    store.setRedoStack(prev => prev.slice(0, -1));
    store.setCurrentLayoutSaved(false);
    store.setUndoStack(prev => [...prev, last]);
    toast.success("Redone");
  };

  const handleUndoRef = useRef(handleUndoResource);
  const handleRedoRef = useRef(handleRedoResource);

  useEffect(() => {
    handleUndoRef.current = handleUndoResource;
    handleRedoRef.current = handleRedoResource;
  });

  return { handleUndoRef, handleRedoRef };
}