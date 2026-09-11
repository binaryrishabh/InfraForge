import { DndContext } from "@dnd-kit/core";
import { useCanvasDragDrop } from "../hooks/useCanvasDragDrop";
import { useCanvasKeyboardShortcuts } from "../hooks/useCanvasKeyboardShortcuts";
import { useCanvasPersistence } from "../hooks/useCanvasPersistence";
import { CanvasTopbar } from "../topbar/CanvasTopbar";
import { ResourcePaletteDrawer } from "./ResourcePaletteDrawer";
import { CanvasBoard } from "./CanvasBoard";
import { CanvasEmptyState } from "./CanvasEmptyState";
import { CanvasConfigPanelWrapper } from "./CanvasConfigPanelWrapper";
import { CanvasModals } from "./CanvasModals";
import { CanvasDragLayer } from "./CanvasDragLayer";
import { ZoomControls } from "./ZoomControls";
import { HistoryControls } from "./HistoryControls";
import { CanvasStatusPill } from "./CanvasStatusPill";
import { GestureHintPill } from "./GestureHintPill";
import { CanvasLiveMode } from "./CanvasLiveMode";
import { ShellMenu } from "@/components/shell/ShellMenu";
import { useCanvasStore } from "../store/canvasStore";

export function CanvasDesignerPage() {
  useCanvasPersistence();
  useCanvasKeyboardShortcuts();
  const dragDrop = useCanvasDragDrop();
  const activeDeploymentId = useCanvasStore((s) => s.activeDeploymentId);

  if (activeDeploymentId) {
    return <CanvasLiveMode deploymentId={activeDeploymentId} />;
  }

  return (
    <DndContext
      sensors={dragDrop.sensors}
      collisionDetection={dragDrop.collisionDetection}
      measuring={dragDrop.measuring}
      onDragStart={dragDrop.onDragStart}
      onDragEnd={dragDrop.onDragEnd}
    >
      {/* Full-bleed canvas surface; chrome floats above it. */}
      <div className="relative h-screen bg-[#0f1117] text-white overflow-hidden">
        <div className="absolute inset-0 flex overflow-hidden">
          <CanvasBoard />
          <CanvasEmptyState />
          <ZoomControls />
          <HistoryControls />
          <CanvasStatusPill />
          <GestureHintPill />
          <ResourcePaletteDrawer />
        </div>
        <CanvasTopbar />
        {/* Hamburger shell menu at the top-right, aligned to navbar level
            (top-3 + h-12 button matches the floating topbar band). */}
        <div className="absolute top-3 right-4 z-40">
          <ShellMenu />
        </div>
        <CanvasConfigPanelWrapper />
        <CanvasModals />
        <CanvasDragLayer />
      </div>
    </DndContext>
  );
}