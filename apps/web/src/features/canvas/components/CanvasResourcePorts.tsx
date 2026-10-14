import type { PointerEvent } from "react";
import type { ResourceType } from "@infraforge/domain/resource";
import { cx } from "@/ui/cx";
import type { ConnectionSide } from "../utils/connectionSides";

const POSITION: Record<ConnectionSide, string> = {
  top: "-top-3.5 left-1/2 -translate-x-1/2",
  bottom: "-bottom-3.5 left-1/2 -translate-x-1/2",
  left: "-left-3.5 top-1/2 -translate-y-1/2",
  right: "-right-3.5 top-1/2 -translate-y-1/2",
};
const SIDES: ConnectionSide[] = ["top", "right", "bottom", "left"];

/* Pointer-only connection handles. Keyboard users connect from the inspector. */
export function CanvasResourcePorts({ resourceId, resourceType, occupiedSides, onStartConnection }: {
  resourceId: string; resourceType: ResourceType; occupiedSides: string;
  onStartConnection: (sourceId: string, sourceType: ResourceType, clientX: number, clientY: number) => void;
}) {
  const occupied = new Set(occupiedSides ? occupiedSides.split(",") : []);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onStartConnection(resourceId, resourceType, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  return (
    <>
      {SIDES.map((side) => (
        <div key={side} aria-hidden="true" title="Drag to connect" onPointerDown={start}
          className={cx("group/port absolute z-20 flex size-7 items-center justify-center cursor-crosshair transition-opacity duration-150", POSITION[side],
            occupied.has(side) ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}>
          <span className={cx("rounded-full border-2 border-ink bg-raised transition-transform duration-150 group-hover/port:scale-125",
            occupied.has(side) ? "size-3" : "size-2.5 border-accent")} />
        </div>
      ))}
    </>
  );
}
