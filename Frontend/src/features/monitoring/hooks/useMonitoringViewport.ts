import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { NODE_CARD_WIDTH, NODE_CARD_HEIGHT } from "../components/MonitoringDashboardCard";
import { computeFitViewport } from "@/features/canvas/utils/computeFitViewport";
import { setGlobalDragCursor } from "@/features/canvas/utils/dragCursor";

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
const FIT_MIN_SCALE = 0.3;
const FIT_MAX_SCALE = 1.0;
const FIT_PADDING = 96;
const NODE_SIZE = NODE_CARD_WIDTH;
const NODE_HEIGHT = NODE_CARD_HEIGHT;
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

  // Same pure fit math as the designer, with monitoring's own padding/clamps,
  // wrapped in the glide animation so reframes feel cinematic, not jumpy.
  const fitToNodes = useCallback((nodes: { x: number; y: number }[]) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fit = computeFitViewport(
      nodes,
      rect.width,
      rect.height,
      NODE_SIZE,
      NODE_HEIGHT,
      { padding: FIT_PADDING, minScale: FIT_MIN_SCALE, maxScale: FIT_MAX_SCALE },
    );
    if (!fit) return;
    if (glideTimerRef.current) clearTimeout(glideTimerRef.current);
    setGlide(true);
    glideTimerRef.current = setTimeout(() => setGlide(false), GLIDE_MS + 100);
    setViewport(fit);
  }, []);

  const handlePanStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingNodeRef.current) return;
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    disableGlide();
    const { translateX, translateY } = viewportRef.current;
    panStateRef.current = { active: true, startX: e.clientX, startY: e.clientY, startTx: translateX, startTy: translateY };
    setGlobalDragCursor(true);
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
    setGlobalDragCursor(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const startNodeDrag = useCallback((nodeId: string, clientX: number, clientY: number, pointerId: number) => {
    disableGlide();
    draggingNodeRef.current = nodeId;
    const pointer = screenToCanvas(clientX, clientY);
    const offset = nodeOffsetsRef.current[nodeId] || { dx: 0, dy: 0 };
    nodeDragStartRef.current = { pointerX: pointer.x, pointerY: pointer.y, startDx: offset.dx, startDy: offset.dy };
    setGlobalDragCursor(true);
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
    setGlobalDragCursor(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
  }, []);

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