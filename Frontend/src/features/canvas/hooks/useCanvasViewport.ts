import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { computeFitViewport } from "../utils/computeFitViewport";
import { setGlobalDragCursor } from "../utils/dragCursor";
import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2.0;
const FIT_MIN_SCALE = 0.2;
const FIT_MAX_SCALE = 1.5;
const FIT_PADDING = 64;
// Wheel zoom speed — doubled from 0.001 after the "zoom is slow" report.
const WHEEL_ZOOM_INTENSITY = 0.002;

/* Standalone fit-view. Reads the DOM + store directly so both the hook and
the zoom controls can call it without prop-drilling. Frames every card
using the REAL card dimensions (this was the auto-fit bug: it used to
frame 48px boxes while cards are 208x160). While LIVE, autoscaled replicas
are part of the visible topology, so manual fit-view frames them too;
spawning itself never reframes (no auto-fit trigger touches replicas). */
export function fitCanvasView() {
  const store = useCanvasStore.getState();
  const nodes: Array<{ x: number; y: number }> = [...store.resources];
  if (store.liveMode) {
    for (const vm of useSimulationStore.getState().spawnedVms) {
      nodes.push({ x: vm.x, y: vm.y });
    }
  }
  if (nodes.length === 0) return;
  const container = document.getElementById("canvas");
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const fit = computeFitViewport(
    nodes,
    rect.width,
    rect.height,
    NODE_CARD_WIDTH,
    NODE_CARD_HEIGHT,
    { padding: FIT_PADDING, minScale: FIT_MIN_SCALE, maxScale: FIT_MAX_SCALE },
  );
  if (!fit) return;
  store.setViewport(fit.scale, fit.translateX, fit.translateY);
}

interface PanState {
  active: boolean;
  startX: number;
  startY: number;
  startTx: number;
  startTy: number;
}

export function useCanvasViewport() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panStateRef = useRef<PanState>({
    active: false,
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
  });

  // Convert a screen (client) point into canvas-space coordinates, accounting
  // for the current pan + zoom. Inverse of the world transform.
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const { scale, translateX, translateY } = useCanvasStore.getState();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - translateX) / scale,
      y: (clientY - rect.top - translateY) / scale,
    };
  }, []);

  // Zoom toward the cursor: the canvas point under the cursor stays fixed.
  // Native WheelEvent — attached below with { passive: false } so preventDefault
  // actually blocks the browser's own page-zoom/scroll.
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const store = useCanvasStore.getState();
    const { scale } = store;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (1 + -e.deltaY * WHEEL_ZOOM_INTENSITY)));
    if (nextScale === scale) return;
    // Canvas-space point currently under the cursor (before zoom).
    const cursor = screenToCanvas(e.clientX, e.clientY);
    // Solve for the translate that keeps that same point under the cursor.
    const nextTx = e.clientX - rect.left - cursor.x * nextScale;
    const nextTy = e.clientY - rect.top - cursor.y * nextScale;
    store.setViewport(nextScale, nextTx, nextTy);
  }, [screenToCanvas]);

  // Native non-passive wheel listener so preventDefault() actually works.
  // React's onWheel is passive — the browser's own page-zoom would hijack it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Pan only starts when the empty canvas background itself is pressed.
  const handlePanStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    const store = useCanvasStore.getState();
    panStateRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startTx: store.translateX,
      startTy: store.translateY,
    };
    setGlobalDragCursor(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePanMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current;
    if (!pan.active) return;
    const store = useCanvasStore.getState();
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    // Pan is a pure translation — scale stays unchanged.
    store.setViewport(store.scale, pan.startTx + dx, pan.startTy + dy);
  }, []);

  const handlePanEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current;
    if (!pan.active) return;
    pan.active = false;
    setGlobalDragCursor(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  return {
    containerRef,
    screenToCanvas,
    handleWheel,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    fitView: fitCanvasView,
  };
}