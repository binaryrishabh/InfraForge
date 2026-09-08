import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";
import type { ConnectionSide } from "../utils/connectionSides";

interface CanvasResourcePortsProps {
  resourceId: string;
  resourceType: ResourceType;
  occupiedSides: string;
  onStartConnection: (
    sourceId: string,
    sourceType: ResourceType,
    clientX: number,
    clientY: number
  ) => void;
}

// 28px invisible grab zone centered on each card edge — generous target,
// zero visual noise.
const SIDE_POSITION_CLASS: Record<ConnectionSide, string> = {
  top: "-top-3.5 left-1/2 -translate-x-1/2",
  bottom: "-bottom-3.5 left-1/2 -translate-x-1/2",
  left: "-left-3.5 top-1/2 -translate-y-1/2",
  right: "-right-3.5 top-1/2 -translate-y-1/2",
};

const SIDES: ConnectionSide[] = ["top", "right", "bottom", "left"];

export function CanvasResourcePorts({
  resourceId,
  resourceType,
  occupiedSides,
  onStartConnection,
}: CanvasResourcePortsProps) {
  const occupied = new Set(occupiedSides === "" ? [] : occupiedSides.split(","));

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    onStartConnection(
      resourceId,
      resourceType,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
  };

  return (
    <>
      {SIDES.map((side) => {
        const isOccupied = occupied.has(side);
        return (
          <div
            key={side}
            // z-20 keeps every port above its OWN card body. The card
            // wrapper's z-10 stacking context still contains it, so ports
            // never paint above sibling cards.
            className={`group/port absolute ${SIDE_POSITION_CLASS[side]} z-20 w-7 h-7 flex items-center justify-center cursor-crosshair transition-opacity duration-150 ${
              isOccupied ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            title={isOccupied ? "Drag another connection from this port" : "Drag to connect"}
            onPointerDown={handlePointerDown}
          >
            {isOccupied ? (
              // Plugged port: quiet accent socket with a dark separation ring
              // so it reads on top of both the card face and the canvas.
              <span className="w-3.5 h-3.5 rounded-full bg-[#12161F] border-2 border-[#5B8CFF]/60 ring-2 ring-[#0B0E14]/70 flex items-center justify-center transition-colors duration-150 hover:border-[#7AA2FF]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7AA2FF]" />
              </span>
            ) : (
              // Free port: accent dot with the same separation ring and a
              // gentle grow on hover — visible only while the card is hovered.
              <span className="w-2.5 h-2.5 rounded-full bg-[#5B8CFF] ring-2 ring-[#0B0E14]/70 transition-transform duration-150 group-hover/port:scale-125" />
            )}
          </div>
        );
      })}
    </>
  );
}