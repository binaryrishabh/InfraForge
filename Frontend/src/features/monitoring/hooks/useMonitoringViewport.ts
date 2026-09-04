import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
const FIT_MIN_SCALE = 0.3;
const FIT_MAX_SCALE = 1.0;
const FIT_PADDING = 64;
const NODE_SIZE = 48;
const WHEEL_ZOOM_INTENSITY = 0.002;
const GLIDE_MS = 500;

interface Viewport {
  scale: number;
  translateX: number;
  translateY: number;
}

interface PanState {
  active: boolean;
  startX: number;
  startY: number;
  startTx: number;
  startTy: number;
}

interface NodeOffset {
  dx: number;
  dy: number;
}

export function useMonitoringViewport() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, translateX: 0, translateY: 0 });
  const [glide, setGlide] = useState(false);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, NodeOffset>>({});

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const nodeOffsetsRef = useRef(nodeOffsets);
  nodeOffsetsRef.current = nodeOffsets;

  const glideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panStateRef = useRef<PanState>({ active: false, startX: 0, startY: 0, startTx: 0, startTy: 0 });
  const draggingNodeRef = useRef<string | null>(null);
  const nodeDragStartRef = useRef<{ pointerX: number; pointerY: number; startDx: number; startDy: number } | null>(null);

  /* Convert a screen (client) point into canvas-space coordinates. */
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const { scale, translateX, translateY } = viewportRef.current;
    return {
      x: (clientX - rect.left - translateX) / scale,
      y: (clientY - rect.top - translateY) / scale,
    };
  }, []);

  const disableGlide = useCallback(() => {
    if (glideTimerRef.current) {
      clearTimeout(glideTimerRef.current);
      glideTimerRef.current = null;
    }
    setGlide(false);
  }, []);

  /* Wheel zoom toward the cursor (native non-passive listener). */
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    disableGlide();
    setViewport(prev => {
      const { scale, translateX, translateY } = prev;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (1 + -e.deltaY * WHEEL_ZOOM_INTENSITY)));
      if (nextScale === scale) return prev;
      const cursorX = (e.clientX - rect.left - translateX) / scale;
      const cursorY = (e.clientY - rect.top - translateY) / scale;
      return {
        scale: nextScale,
        translateX: e.clientX - rect.left - cursorX * nextScale,
        translateY: e.clientY - rect.top - cursorY * nextScale,
      };
    });
  }, [disableGlide]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  /* Auto-fit: frame a set of nodes with padding, gliding smoothly. */
  const fitToNodes = useCallback((nodes: { x: number; y: number }[]) => {
    const el = containerRef.current;
    if (!el || nodes.length === 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + NODE_SIZE > maxX) maxX = n.x + NODE_SIZE;
      if (n.y + NODE_SIZE > maxY) maxY = n.y + NODE_SIZE;
    }
    const boxW = maxX - minX;
    const boxH = maxY - minY;
    if (boxW <= 0 || boxH <= 0) return;
    // Never zoom in past 100%, never shrink below 30% — only zoom out to fit.
    const scale = Math.min(
      FIT_MAX_SCALE,
      Math.max(FIT_MIN_SCALE, Math.min((rect.width - FIT_PADDING * 2) / boxW, (rect.height - FIT_PADDING * 2) / boxH))
    );
    const translateX = (rect.width - boxW * scale) / 2 - minX * scale;
    const translateY = (rect.height - boxH * scale) / 2 - minY * scale;
    if (glideTimerRef.current) clearTimeout(glideTimerRef.current);
    setGlide(true);
    glideTimerRef.current = setTimeout(() => setGlide(false), GLIDE_MS + 100);
    setViewport({ scale, translateX, translateY });
  }, []);

  /* Background pan (only when the empty canvas itself is pressed). */
  const handlePanStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingNodeRef.current) return;
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    disableGlide();
    const { translateX, translateY } = viewportRef.current;
    panStateRef.current = { active: true, startX: e.clientX, startY: e.clientY, startTx: translateX, startTy: translateY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [disableGlide]);

  const handlePanMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current;
    if (!pan.active) return;
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    setViewport(prev => ({ ...prev, translateX: pan.startTx + dx, translateY: pan.startTy + dy }));
  }, []);

  const handlePanEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current;
    if (!pan.active) return;
    pan.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  /* Node dragging — cosmetic local repositioning (does not touch the sim/layout). */
  const startNodeDrag = useCallback((nodeId: string, clientX: number, clientY: number, pointerId: number) => {
    disableGlide();
    draggingNodeRef.current = nodeId;
    const pointer = screenToCanvas(clientX, clientY);
    const offset = nodeOffsetsRef.current[nodeId] || { dx: 0, dy: 0 };
    nodeDragStartRef.current = { pointerX: pointer.x, pointerY: pointer.y, startDx: offset.dx, startDy: offset.dy };
    try {
      containerRef.current?.setPointerCapture(pointerId);
    } catch {
      /* capture unsupported — drag still works inside the container */
    }
  }, [screenToCanvas, disableGlide]);

  const moveNodeDrag = useCallback((clientX: number, clientY: number) => {
    const nodeId = draggingNodeRef.current;
    const start = nodeDragStartRef.current;
    if (!nodeId || !start) return;
    const pointer = screenToCanvas(clientX, clientY);
    const dx = start.startDx + (pointer.x - start.pointerX);
    const dy = start.startDy + (pointer.y - start.pointerY);
    setNodeOffsets(prev => ({ ...prev, [nodeId]: { dx, dy } }));
  }, [screenToCanvas]);

  const endNodeDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingNodeRef.current) return;
    draggingNodeRef.current = null;
    nodeDragStartRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
  }, []);

  /* Combined pointer handlers on the container: route node-drag vs pan. */
  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingNodeRef.current) {
      moveNodeDrag(e.clientX, e.clientY);
    } else {
      handlePanMove(e);
    }
  }, [moveNodeDrag, handlePanMove]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingNodeRef.current) {
      endNodeDrag(e);
    } else {
      handlePanEnd(e);
    }
  }, [endNodeDrag, handlePanEnd]);

  const getNodeOffset = useCallback((nodeId: string): NodeOffset => {
    return nodeOffsets[nodeId] || { dx: 0, dy: 0 };
  }, [nodeOffsets]);

  /* Button-driven zoom around the canvas center. */
  const zoomBy = useCallback((factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    disableGlide();
    setViewport(prev => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
      if (nextScale === prev.scale) return prev;
      const cx = (centerX - prev.translateX) / prev.scale;
      const cy = (centerY - prev.translateY) / prev.scale;
      return {
        scale: nextScale,
        translateX: centerX - cx * nextScale,
        translateY: centerY - cy * nextScale,
      };
    });
  }, [disableGlide]);

  const zoomIn = useCallback(() => zoomBy(1.2), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / 1.2), [zoomBy]);
  const resetView = useCallback(() => {
    disableGlide();
    setViewport({ scale: 1, translateX: 0, translateY: 0 });
  }, [disableGlide]);

  return {
    containerRef,
    viewport,
    glide,
    nodeOffsets,
    handlePanStart,
    handlePointerMove,
    handlePointerUp,
    startNodeDrag,
    getNodeOffset,
    fitToNodes,
    zoomIn,
    zoomOut,
    resetView,
  };
}