import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { MIN_SCALE, MAX_SCALE } from "../hooks/useCanvasViewport";

// Wakes on zoom activity or hover, hides this long after the last activity.
const HIDE_AFTER_MS = 5000;
const BUTTON_ZOOM_FACTOR = 1.2;

export const ZoomControls = memo(function ZoomControls() {
  const scale = useCanvasStore((s) => s.scale);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef(false);
  const prevScaleRef = useRef(scale);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }, [clearHideTimer]);

  // Any zoom-level change (wheel, buttons, fit-view) wakes the controls.
  useEffect(() => {
    if (prevScaleRef.current !== scale) {
      prevScaleRef.current = scale;
      setVisible(true);
      if (!hoveredRef.current) scheduleHide();
    }
  }, [scale, scheduleHide]);

  // Clean up the timer on unmount.
  useEffect(() => clearHideTimer, [clearHideTimer]);

  const handleMouseEnter = useCallback(() => {
    hoveredRef.current = true;
    clearHideTimer();
    setVisible(true);
  }, [clearHideTimer]);

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = false;
    scheduleHide();
  }, [scheduleHide]);

  // Zoom around the canvas center.
  const zoomBy = useCallback((factor: number) => {
    const store = useCanvasStore.getState();
    const container = document.getElementById("canvas");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, store.scale * factor));
    if (nextScale === store.scale) return;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const cx = (centerX - store.translateX) / store.scale;
    const cy = (centerY - store.translateY) / store.scale;
    store.setViewport(nextScale, centerX - cx * nextScale, centerY - cy * nextScale);
  }, []);

  const atMin = scale <= MIN_SCALE + 0.001;
  const atMax = scale >= MAX_SCALE - 0.001;

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="absolute bottom-4 right-4 z-30 select-none"
    >
      <div
        className={`flex items-center gap-0.5 bg-[#12161F] border border-[#273042] rounded-lg p-1 shadow-xl transition-opacity duration-150 ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          type="button"
          title="Zoom out"
          onClick={() => zoomBy(1 / BUTTON_ZOOM_FACTOR)}
          disabled={atMin}
          className="w-7 h-7 rounded-md bg-[#0B0E14] border border-[#1F2633] text-[13px] font-medium leading-none text-[#AAB4C5] hover:text-[#EDF1F7] hover:border-[#35415A] active:scale-[0.95] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
        >
          −
        </button>
        <span className="w-12 text-center text-[11px] font-mono text-[#AAB4C5]">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          title="Zoom in"
          onClick={() => zoomBy(BUTTON_ZOOM_FACTOR)}
          disabled={atMax}
          className="w-7 h-7 rounded-md bg-[#0B0E14] border border-[#1F2633] text-[13px] font-medium leading-none text-[#AAB4C5] hover:text-[#EDF1F7] hover:border-[#35415A] active:scale-[0.95] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
        >
          +
        </button>
      </div>
    </div>
  );
});