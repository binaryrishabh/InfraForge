import { useEffect } from "react";
import { useCanvasUndoRedo } from "./useCanvasUndoRedo";

export function useCanvasKeyboardShortcuts() {
  const { handleUndoRef, handleRedoRef } = useCanvasUndoRedo();

  useEffect(() => {
    const handleKeyPressed = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if ((event.ctrlKey || event.metaKey) && !isInput) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) handleRedoRef.current();
          else handleUndoRef.current();
        }
        if (event.key.toLowerCase() === "y") {
          event.preventDefault();
          handleRedoRef.current();
        }
      }
    };
    window.addEventListener("keydown", handleKeyPressed);
    return () => window.removeEventListener("keydown", handleKeyPressed);
  }, [handleUndoRef, handleRedoRef]);
}