import { toast } from "sonner";
import { useCanvasStore } from "./store/canvasStore";
import { positionIsOccupied } from "./utils/cardFootprint";

/* One undo/redo implementation shared by the toolbar, keyboard shortcuts and
"Undo" toast actions. Edits are blocked while a run is starting or locked. */
const blocked = () => {
  const store = useCanvasStore.getState();
  if (store.isDeploying || store.liveLocked) { toast.warning("Editing is paused while this run is in progress."); return true; }
  return false;
};

export function undo() {
  const store = useCanvasStore.getState();
  if (blocked() || store.undoStack.length === 0) return;
  const last = store.undoStack[store.undoStack.length - 1]!;
  switch (last.type) {
    case "add":
      store.setResources((prev) => prev.filter((r) => r.id !== last.resource.id));
      store.setConnectionLines((prev) => prev.filter((l) => l.sourceId !== last.resource.id && l.targetId !== last.resource.id));
      break;
    case "delete":
      if (positionIsOccupied(store.resources, last.resource.x, last.resource.y)) {
        toast.warning("That spot is now occupied, so the resource cannot be restored there.");
        store.setUndoStack((prev) => prev.slice(0, -1));
        return;
      }
      store.setResources((prev) => [...prev, last.resource]);
      store.setConnectionLines((prev) => [...prev, ...last.connectionLines]);
      break;
    case "move":
      store.setResources((prev) => prev.map((r) => (r.id === last.resourceId ? { ...r, x: last.fromX, y: last.fromY } : r)));
      break;
    case "delete-connection":
      store.setConnectionLines((prev) => [...prev, last.connectionLine]);
      break;
    case "add-connection":
      store.setConnectionLines((prev) => prev.filter((l) => l.id !== last.connectionLine.id));
      break;
    case "config":
      store.setResources((prev) => prev.map((r) => (r.id === last.resourceId ? { ...r, ...last.before } : r)));
      break;
  }
  store.setCurrentLayoutSaved(last.savedState);
  store.setUndoStack((prev) => prev.slice(0, -1));
  store.setRedoStack((prev) => [...prev, last]);
}

export function redo() {
  const store = useCanvasStore.getState();
  if (blocked() || store.redoStack.length === 0) return;
  const last = store.redoStack[store.redoStack.length - 1]!;
  switch (last.type) {
    case "add":
      store.setResources((prev) => [...prev, last.resource]);
      store.setConnectionLines((prev) => [...prev, ...last.connectionLines]);
      break;
    case "delete":
      store.setResources((prev) => prev.filter((r) => r.id !== last.resource.id));
      store.setConnectionLines((prev) => prev.filter((l) => l.sourceId !== last.resource.id && l.targetId !== last.resource.id));
      break;
    case "move":
      store.setResources((prev) => prev.map((r) => (r.id === last.resourceId ? { ...r, x: last.toX, y: last.toY } : r)));
      break;
    case "delete-connection":
      store.setConnectionLines((prev) => prev.filter((l) => l.id !== last.connectionLine.id));
      break;
    case "add-connection":
      store.setConnectionLines((prev) => [...prev, last.connectionLine]);
      break;
    case "config":
      store.setResources((prev) => prev.map((r) => (r.id === last.resourceId ? { ...r, ...last.after } : r)));
      break;
  }
  store.setRedoStack((prev) => prev.slice(0, -1));
  store.setCurrentLayoutSaved(false);
  store.setUndoStack((prev) => [...prev, last]);
}
