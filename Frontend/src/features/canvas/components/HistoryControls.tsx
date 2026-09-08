import { memo, useEffect, useRef } from "react";
import { Undo2, Redo2 } from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { useCanvasUndoRedo } from "../hooks/useCanvasUndoRedo";
import { useAutoHideControls } from "../hooks/useAutoHideControls";

// Same footprint as the zoom cluster so the two corners read as one family.
const BUTTON_CLASS =
  "h-8 w-9 rounded-md bg-[#0B0E14] border border-[#1F2633] text-[#AAB4C5] hover:text-[#EDF1F7] hover:border-[#35415A] active:scale-[0.95] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center";

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

  // Undo/redo (keyboard shortcut or button) pops a stack — wake the cluster
  // so the shortcut's result is visible, then it idles back to hidden.
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
        className={`flex items-center gap-1 bg-[#12161F] border border-[#273042] rounded-lg p-1.5 shadow-xl transition-opacity duration-150 ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          onClick={() => handleUndoRef.current()}
          disabled={!canUndo}
          className={BUTTON_CLASS}
        >
          <Undo2 size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Shift+Z)"
          onClick={() => handleRedoRef.current()}
          disabled={!canRedo}
          className={BUTTON_CLASS}
        >
          <Redo2 size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
});