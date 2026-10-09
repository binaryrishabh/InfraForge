import { memo, useEffect, useRef } from "react";
import { Undo2, Redo2 } from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { useCanvasUndoRedo } from "../hooks/useCanvasUndoRedo";
import { useAutoHideControls } from "../hooks/useAutoHideControls";
import {
  BARE_CONTROL_BUTTON,
  CONTROL_PILL_SURFACE,
} from "../utils/controlPillClass";

/* Bottom-left undo/redo pill on the same floating surface as the zoom
   cluster. Idle-hidden: wakes on hover or on any undo/redo (keyboard shortcut
   or button click — both pop a stack), then re-hides after the 4s idle timeout. */
export const HistoryControls = memo(function HistoryControls() {
  const canUndo = useCanvasStore((s) => s.undoStack.length > 0);
  const canRedo = useCanvasStore((s) => s.redoStack.length > 0);
  const undoDepth = useCanvasStore((s) => s.undoStack.length);
  const redoDepth = useCanvasStore((s) => s.redoStack.length);
  const { visible, wake, handleMouseEnter, handleMouseLeave } =
    useAutoHideControls();
  const { handleUndoRef, handleRedoRef } = useCanvasUndoRedo();
  const prevUndoDepthRef = useRef(undoDepth);
  const prevRedoDepthRef = useRef(redoDepth);

  // Undo pops the undo stack, redo pops the redo stack — either means a
  // shortcut (or button) just fired, so wake the pill to show the result.
  useEffect(() => {
    const undoPopped = undoDepth < prevUndoDepthRef.current;
    const redoPopped = redoDepth < prevRedoDepthRef.current;
    prevUndoDepthRef.current = undoDepth;
    prevRedoDepthRef.current = redoDepth;
    if (undoPopped || redoPopped) wake();
  }, [undoDepth, redoDepth, wake]);

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="absolute bottom-4 left-4 z-30 select-none"
    >
      <div
        className={`${CONTROL_PILL_SURFACE} transition-opacity duration-150 ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          onClick={() => handleUndoRef.current()}
          disabled={!canUndo}
          className={BARE_CONTROL_BUTTON}
        >
          <Undo2 size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Shift+Z)"
          onClick={() => handleRedoRef.current()}
          disabled={!canRedo}
          className={BARE_CONTROL_BUTTON}
        >
          <Redo2 size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
});