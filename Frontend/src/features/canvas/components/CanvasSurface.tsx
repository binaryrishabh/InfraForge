import type { ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import { useCanvasDragDrop } from "../hooks/useCanvasDragDrop";
import { CanvasBoard } from "./CanvasBoard";
import { CanvasEmptyState } from "./CanvasEmptyState";
import { ZoomControls } from "./ZoomControls";
import { HistoryControls } from "./HistoryControls";
import { CanvasStatusPill } from "./CanvasStatusPill";
import { GestureHintPill } from "./GestureHintPill";
import { ResourcePaletteDrawer } from "./ResourcePaletteDrawer";
import { CanvasConfigPanelWrapper } from "./CanvasConfigPanelWrapper";
import { CanvasModals } from "./CanvasModals";
import { CanvasDragLayer } from "./CanvasDragLayer";

interface CanvasSurfaceProps {
  // Positioning / sizing classes for the surface wrapper: h-screen for the
  // standalone design page, flex-1 inside the live flex column.
  className?: string;
  // The "design your infrastructure" empty state is design-mode only.
  showEmptyState?: boolean;
  // Mode-specific floating chrome (topbar, shell menu, ...) rides above the
  // canvas layer but inside the surface so absolute positioning works.
  children?: ReactNode;
}

/* The ONE canvas surface. Owns the dnd wiring, the board, the floating
control pills, the palette drawer, and the overlay family (inspector,
modals, drag ghost). Design and live pages differ only in the chrome they
float above it, which they pass as children — nothing else repeats. */
export function CanvasSurface({
  className = "",
  showEmptyState = false,
  children,
}: CanvasSurfaceProps) {
  const dragDrop = useCanvasDragDrop();
  return (
    <DndContext
      sensors={dragDrop.sensors}
      collisionDetection={dragDrop.collisionDetection}
      measuring={dragDrop.measuring}
      onDragStart={dragDrop.onDragStart}
      onDragEnd={dragDrop.onDragEnd}
    >
      <div className={`relative overflow-hidden ${className}`}>
        <div className="absolute inset-0 flex overflow-hidden">
          <CanvasBoard />
          {showEmptyState && <CanvasEmptyState />}
          <ZoomControls />
          <HistoryControls />
          <CanvasStatusPill />
          <GestureHintPill />
          <ResourcePaletteDrawer />
        </div>
        {children}
        <CanvasConfigPanelWrapper />
        <CanvasModals />
        <CanvasDragLayer />
      </div>
    </DndContext>
  );
}