import { memo, useCallback, useEffect, useRef } from "react";
import { useCanvasStore } from "../store/canvasStore";
import {
  MIN_SCALE,
  MAX_SCALE,
  fitCanvasView,
} from "../hooks/useCanvasViewport";
import { useAutoHideControls } from "../hooks/useAutoHideControls";
import {
  BARE_CONTROL_BUTTON,
  CONTROL_PILL_SURFACE,
} from "../utils/controlPillClass";

const BUTTON_ZOOM_FACTOR = 1.2;

/* Fit-view glyph: a square box framed by four corner brackets — the classic
   "frame the content" read, replacing the old rotate-ccw icon. */
function FitViewIcon({ size = 15 }: { size?: number }) {
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

/* Idle-hidden pill: wakes on hover or any zoom activity, re-hides after the
   shared 4s idle timeout. The wrapper stays hoverable so hover can wake it. */
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
        className={`${CONTROL_PILL_SURFACE} transition-opacity duration-150 ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          type="button"
          title="Zoom out"
          onClick={() => zoomBy(1 / BUTTON_ZOOM_FACTOR)}
          disabled={atMin}
          className={BARE_CONTROL_BUTTON}
        >
          −
        </button>
        <span className="w-14 text-center text-[13px] font-mono tabular-nums text-[#EDF1F7]">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          title="Zoom in"
          onClick={() => zoomBy(BUTTON_ZOOM_FACTOR)}
          disabled={atMax}
          className={BARE_CONTROL_BUTTON}
        >
          +
        </button>
        <button
          type="button"
          title="Fit view"
          onClick={() => fitCanvasView()}
          className={BARE_CONTROL_BUTTON}
        >
          <FitViewIcon size={15} />
        </button>
      </div>
    </div>
  );
});