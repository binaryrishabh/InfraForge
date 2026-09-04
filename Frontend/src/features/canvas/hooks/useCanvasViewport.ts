import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useCanvasStore } from "../store/canvasStore";

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2.0;
const FIT_MIN_SCALE = 0.2;
const FIT_MAX_SCALE = 1.5;
const FIT_PADDING = 64;
const NODE_SIZE = 48;
// Wheel zoom speed — doubled from 0.001 after the "zoom is slow" report.
const WHEEL_ZOOM_INTENSITY = 0.002;

/* Standalone fit-view. Reads the DOM + store directly so both the hook and the
   topbar can call it without prop-drilling. Frames every resource with padding. */
export function fitCanvasView() {
  const store = useCanvasStore.getState();
  const resources = store.resources;
  if (resources.length === 0) return;

  const container = document.getElementById("canvas");
  if (!container) return;
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of resources) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + NODE_SIZE > maxX) maxX = r.x + NODE_SIZE;
    if (r.y + NODE_SIZE > maxY) maxY = r.y + NODE_SIZE;
  }

  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  if (boxWidth <= 0 || boxHeight <= 0) return;

  const scaleX = (rect.width - FIT_PADDING * 2) / boxWidth;
  const scaleY = (rect.height - FIT_PADDING * 2) / boxHeight;
  const scale = Math.min(FIT_MAX_SCALE, Math.max(FIT_MIN_SCALE, Math.min(scaleX, scaleY)));

  // Center the fitted box inside the container.
  const tx = (rect.width - boxWidth * scale) / 2 - minX * scale;
  const ty = (rect.height - boxHeight * scale) / 2 - minY * scale;
  store.setViewport(scale, tx, ty);
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