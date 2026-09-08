import { memo, useCallback, useEffect, useRef } from "react";
import { useCanvasStore } from "../store/canvasStore";
import {
  MIN_SCALE,
  MAX_SCALE,
  fitCanvasView,
} from "../hooks/useCanvasViewport";
import { useAutoHideControls } from "../hooks/useAutoHideControls";

const BUTTON_ZOOM_FACTOR = 1.2;

// ~30% larger controls: height up slightly (28->32), width up more (28->36).
const BUTTON_CLASS =
  "h-8 w-9 rounded-md bg-[#0B0E14] border border-[#1F2633] text-[#AAB4C5] hover:text-[#EDF1F7] hover:border-[#35415A] active:scale-[0.95] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center";

/* Fit-view glyph: a square box framed by four corner brackets — the classic
   "frame the content" read, replacing the old rotate-ccw icon. */
function FitViewIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* center square box */}
      <rect x="4.5" y="4.5" width="5" height="5" rx="0.5" />
      {/* corner brackets */}
      <path d="M1 3.5 V1 H3.5" />
      <path d="M10.5 1 H13 V3.5" />
      <path d="M13 10.5 V13 H10.5" />
      <path d="M3.5 13 H1 V10.5" />
    </svg>
  );
}

export const ZoomControls = memo(function ZoomControls() {
  const scale = useCanvasStore((s) => s.scale);
  const { visible, wake, handleMouseEnter, handleMouseLeave } =
    useAutoHideControls();
  const prevScaleRef = useRef(scale);

  // Any zoom-level change (wheel, buttons, fit-view) wakes the controls.
  useEffect(() => {
    if (prevScaleRef.current !== scale) {
      prevScaleRef.current = scale;
      wake();
    }
  }, [scale, wake]);

  // Zoom around the canvas center.
  const zoomBy = useCallback((factor: number) => {
    const store = useCanvasStore.getState();
    const container = document.getElementById("canvas");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, store.scale * factor),
    );
    if (nextScale === store.scale) return;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const cx = (centerX - store.translateX) / store.scale;
    const cy = (centerY - store.translateY) / store.scale;
    store.setViewport(
      nextScale,
      centerX - cx * nextScale,
      centerY - cy * nextScale,
    );
  }, []);

  const atMin = scale <= MIN_SCALE + 0.001;
  const atMax = scale >= MAX_SCALE + 0.001;

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="absolute bottom-4 right-4 z-30 select-none"
    >
      <div
        className={`flex items-center gap-1 bg-[#12161F] border border-[#273042] rounded-lg p-1.5 shadow-xl transition-opacity duration-150 ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          type="button"
          title="Zoom out"
          onClick={() => zoomBy(1 / BUTTON_ZOOM_FACTOR)}
          disabled={atMin}
          className={`${BUTTON_CLASS} text-[15px] font-medium leading-none`}
        >
          −
        </button>
        <span className="w-14 text-center text-[15px] font-mono text-[#AAB4C5]">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          title="Zoom in"
          onClick={() => zoomBy(BUTTON_ZOOM_FACTOR)}
          disabled={atMax}
          className={`${BUTTON_CLASS} text-[15px] font-medium leading-none`}
        >
          +
        </button>
        <button
          type="button"
          title="Fit view"
          onClick={() => fitCanvasView()}
          className={BUTTON_CLASS}
        >
          <FitViewIcon size={16} />
        </button>
      </div>
    </div>
  );
});