import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { UndoCanvasResourceAction } from "@shared/types/UndoCanvasResourceAction.types";

interface UseCanvasUndoRedoProps {
  isDeploying: boolean;
  canvasResources: Resource[];
  setCanvasResources: React.Dispatch<React.SetStateAction<Resource[]>>;
  connectionLines: ConnectionLine[];
  setConnectionLines: React.Dispatch<React.SetStateAction<ConnectionLine[]>>;
  setCurrentLayoutSaved: (saved: boolean) => void;
}

export function useCanvasUndoRedo({
  isDeploying,
  canvasResources,
  setCanvasResources,
  // connectionLines,
  setConnectionLines,
  setCurrentLayoutSaved,
}: UseCanvasUndoRedoProps) {
  /* ---------- Undo/Redo Code ------------ */
  // This is for the undo stack for canavs resources....
  const [undoResourcesSnapshotStackTrace, setUndoResourcesSnapshotStackTrace] = useState<UndoCanvasResourceAction[]>([]);

  // This is for the redo stack for canavs resources....
  const [redoResourcesSnapshotStackTrace, setRedoResourcesSnapshotStackTrace] = useState<UndoCanvasResourceAction[]>([]);

  // Undo Resource Delete handler
  const handleUndoResource = () => {
    if (isDeploying) {
      toast.warning("Can't undo or redo as deployemnt is in process");
      return;
    }

    if (undoResourcesSnapshotStackTrace.length === 0) {
      return;
    }

    // fetch the last resource as present in the undo stack that u want to undo
    const lastResourceSnapshotFromUndoStack = undoResourcesSnapshotStackTrace[undoResourcesSnapshotStackTrace.length - 1];

    if (!lastResourceSnapshotFromUndoStack) {
      return;
    }

    if (lastResourceSnapshotFromUndoStack.type === "add") { // Undo add = remove the resource
      //Filter out i.e. remove the resource & connectionLines from the canvas i.e. X button of a resource has been clicked.
      setCanvasResources(prev => prev.filter(resource => resource.id !== lastResourceSnapshotFromUndoStack.resource.id));
      setConnectionLines(prev => prev.filter(resource => resource.sourceId !== lastResourceSnapshotFromUndoStack.resource.id && resource.targetId !== lastResourceSnapshotFromUndoStack.resource.id));
      setCurrentLayoutSaved(lastResourceSnapshotFromUndoStack.savedState);
    }
    else { // Undo delete = restore/add the resource
      // Overlap check
      const occupied = canvasResources.some(
        resource => Math.abs(resource.x - lastResourceSnapshotFromUndoStack.resource.x) < 40 && Math.abs(resource.y - lastResourceSnapshotFromUndoStack.resource.y) < 40
      )

      // Don't put as place has already been occupied
      if (occupied) {
        toast.warning("Can't undo - that spot is now occupied");
        // Drop this lastResourceSnapshotFromUndoStack and we don't place this one as potition has already been occupied, keep the rest.
        setUndoResourcesSnapshotStackTrace(prev => prev.slice(0, -1));
        return;
      }

      // Add back to canvas
      setCanvasResources(prev => [...prev, lastResourceSnapshotFromUndoStack.resource]);
      setConnectionLines(prev => [...prev, ...lastResourceSnapshotFromUndoStack.connectionLines]);
      setCurrentLayoutSaved(lastResourceSnapshotFromUndoStack.savedState);
    }

    // Remove from the undo stack
    setUndoResourcesSnapshotStackTrace(prev => prev.slice(0, -1));

    // Push to redo stack
    setRedoResourcesSnapshotStackTrace(prev => [...prev, lastResourceSnapshotFromUndoStack]);

    console.log(lastResourceSnapshotFromUndoStack);
    console.log(redoResourcesSnapshotStackTrace);
    console.log(canvasResources);

    toast.success("Undo");
  }

  // Redo Deleted Resouces from canvas handler
  const handleRedoResource = () => {
    if (isDeploying) {
      toast.warning("Can't undo or redo as deployemnt is in process");
      return;
    }

    if (redoResourcesSnapshotStackTrace.length === 0) {
      return;
    }

    // fetch the last resource from the redo stack that u want to redo
    const lastResourceSnapshotFromRedoStack = redoResourcesSnapshotStackTrace[redoResourcesSnapshotStackTrace.length - 1];

    if (lastResourceSnapshotFromRedoStack.type === "add") { // Redo add = add it back to canvas
      // Add the resource + it's connections again to the canvas that u have undo lately
      setCanvasResources(prev => [...prev, lastResourceSnapshotFromRedoStack.resource]);
      setConnectionLines(prev => [...prev, ...lastResourceSnapshotFromRedoStack.connectionLines]);
    }
    else { // Redo delete = delete it from the canvas
      // Delete the resource + it's connections again from the canvas that u have undo lately
      setCanvasResources(prev => prev.filter(resource => resource.id !== lastResourceSnapshotFromRedoStack.resource.id));
      setConnectionLines(prev => prev.filter(resource => resource.sourceId !== lastResourceSnapshotFromRedoStack.resource.id && resource.targetId !== lastResourceSnapshotFromRedoStack.resource.id));
    }

    setRedoResourcesSnapshotStackTrace(prev => prev.slice(0, -1));
    setCurrentLayoutSaved(false);
    setUndoResourcesSnapshotStackTrace(prev => [...prev, lastResourceSnapshotFromRedoStack]); // Add the redo resource to the undo resource stack
    toast.success("Redone");
  }

  const handleUndoRef = useRef(handleUndoResource);
  const handleRedoRef = useRef(handleRedoResource);

  // Set the ref's to the functions so to avoid stale data
  useEffect(() => {
    handleUndoRef.current = handleUndoResource;
    handleRedoRef.current = handleRedoResource;
  });

  return {
    undoResourcesSnapshotStackTrace,
    setUndoResourcesSnapshotStackTrace,
    redoResourcesSnapshotStackTrace,
    setRedoResourcesSnapshotStackTrace,
    handleUndoRef,
    handleRedoRef,
  };
}