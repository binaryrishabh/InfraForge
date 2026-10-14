import { useEffect } from "react";
import { toast } from "sonner";
import { saveDesign } from "../designActions";
import { useCanvasStore } from "../store/canvasStore";
import { redo, undo } from "../history";
import { deleteConnection, selectResource } from "../actions";
import { zoomIn, zoomOut } from "./useCanvasViewport";

const typing = (target: EventTarget | null) => target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/* Designer-wide shortcuts: undo/redo, remove a selected connection, clear the
selection and zoom. Ignored while typing or while a dialog is open. */
export function useCanvasKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useCanvasStore.getState();
      if (store.modalState || store.modalLoading || document.querySelector("[role=dialog]")) return;
      if (typing(event.target) && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s")) return;
      if (store.activeDeploymentId && !(event.key === "Escape" || event.key === "+" || event.key === "=" || event.key === "-")) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (mod && key === "y") { event.preventDefault(); redo(); }
      else if (mod && key === "s") { event.preventDefault(); saveDesign().then((done) => { if (done) toast.success("Design saved"); }).catch(() => toast.error("The design could not be saved.")); }
      else if (!mod && (event.key === "Delete" || event.key === "Backspace") && store.selectedConnectionId) { event.preventDefault(); deleteConnection(store.selectedConnectionId); }
      else if (event.key === "Escape" && (store.selectedResourceId || store.selectedConnectionId)) { selectResource(null); store.setSelectedConnectionId(null); }
      else if (!mod && (event.key === "+" || event.key === "=")) zoomIn();
      else if (!mod && event.key === "-") zoomOut();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
