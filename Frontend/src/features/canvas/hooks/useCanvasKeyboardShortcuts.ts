import { useEffect, useRef } from "react";
import { useCanvasUndoRedo } from "./useCanvasUndoRedo";
import { useCanvasResourceActions } from "./useCanvasResourceActions";
import { useCanvasStore } from "../store/canvasStore";

export function useCanvasKeyboardShortcuts() {
  const { handleUndoRef, handleRedoRef } = useCanvasUndoRedo();
  const { handleDeleteConnectionLine } = useCanvasResourceActions();

  const handleDeleteConnectionLineRef = useRef(handleDeleteConnectionLine);
  useEffect(() => {
    handleDeleteConnectionLineRef.current = handleDeleteConnectionLine;
  });

  useEffect(() => {
    const handleKeyPressed = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (isInput) return;

      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) handleRedoRef.current();
          else handleUndoRef.current();
        }
        if (event.key.toLowerCase() === "y") {
          event.preventDefault();
          handleRedoRef.current();
        }
      } else if (event.key === "Delete" || event.key === "Backspace") {
        const selectedConnectionId = useCanvasStore.getState().selectedConnectionId;
        if (selectedConnectionId) {
          event.preventDefault();
          handleDeleteConnectionLineRef.current(selectedConnectionId);
        }
      }
    };
    window.addEventListener("keydown", handleKeyPressed);
    return () => window.removeEventListener("keydown", handleKeyPressed);
  }, [handleUndoRef, handleRedoRef]);
}