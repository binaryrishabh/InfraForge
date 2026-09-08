import { useCallback, useEffect, useRef, useState } from "react";

// Idle timeout shared by the zoom and history clusters (3-4s band).
const HIDE_AFTER_MS = 4000;

/* Auto-hide behavior for floating canvas control clusters: hidden at idle,
   wakes on hover or on explicit wake() calls (zoom change, undo/redo),
   then schedules a re-hide once the pointer leaves or activity stops. */
export function useAutoHideControls() {
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef(false);

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

  const wake = useCallback(() => {
    setVisible(true);
    if (!hoveredRef.current) scheduleHide();
  }, [scheduleHide]);

  const handleMouseEnter = useCallback(() => {
    hoveredRef.current = true;
    clearHideTimer();
    setVisible(true);
  }, [clearHideTimer]);

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = false;
    scheduleHide();
  }, [scheduleHide]);

  // Clean up the timer on unmount.
  useEffect(() => clearHideTimer, [clearHideTimer]);

  return { visible, wake, handleMouseEnter, handleMouseLeave };
}