import { DndContext } from "@dnd-kit/core";
import { useCanvasDragDrop } from "../hooks/useCanvasDragDrop";
import { useCanvasKeyboardShortcuts } from "../hooks/useCanvasKeyboardShortcuts";
import { useCanvasPersistence } from "../hooks/useCanvasPersistence";
import { CanvasTopbar } from "../topbar/CanvasTopbar";
import { ResourceSidebar } from "./ResourceSidebar";
import { CanvasBoard } from "./CanvasBoard";
import { CanvasEmptyState } from "./CanvasEmptyState";
import { CanvasConfigPanelWrapper } from "./CanvasConfigPanelWrapper";
import { CanvasActiveDeployment } from "./CanvasActiveDeployment";
import { CanvasModals } from "./CanvasModals";
import { CanvasDragLayer } from "./CanvasDragLayer";
import { ZoomControls } from "./ZoomControls";

export function CanvasDesignerPage() {
  useCanvasPersistence();
  useCanvasKeyboardShortcuts();
  const dragDrop = useCanvasDragDrop();

  return (
    <DndContext sensors={dragDrop.sensors} onDragStart={dragDrop.onDragStart} onDragEnd={dragDrop.onDragEnd}>
      <div className="flex flex-col h-screen bg-[#0f1117] text-white">
        <CanvasTopbar />
        <div className="flex flex-1 overflow-hidden relative">
          <ResourceSidebar />
          <CanvasBoard />
          <CanvasEmptyState />
          <ZoomControls />
        </div>
      </div>
      <CanvasConfigPanelWrapper />
      <CanvasActiveDeployment />
      <CanvasModals />
      <CanvasDragLayer />
    </DndContext>
  );
}