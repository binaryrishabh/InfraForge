import type { ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import { useCanvasDragDrop } from "../hooks/useCanvasDragDrop";
import { CanvasDragLayer } from "./CanvasDragLayer";

/* One drag-and-drop context spans the palette and the canvas so a resource can
be dragged from the docked palette straight onto the drafting sheet. */
export function CanvasDnd({ children }: { children: ReactNode }) {
  const dnd = useCanvasDragDrop();
  return (
    <DndContext sensors={dnd.sensors} collisionDetection={dnd.collisionDetection} measuring={dnd.measuring}
      onDragStart={dnd.onDragStart} onDragEnd={dnd.onDragEnd} accessibility={{ screenReaderInstructions: { draggable: "" } }}>
      {children}
      <CanvasDragLayer />
    </DndContext>
  );
}
