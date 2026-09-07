import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";
import type { ConnectionSide } from "../utils/connectionSides";

interface CanvasResourcePortsProps {
  resourceId: string;
  resourceType: ResourceType;
  // Comma-joined edges that already hold a connection end.
  occupiedSides: string;
  onStartConnection: (
    sourceId: string,
    sourceType: ResourceType,
    clientX: number,
    clientY: number
  ) => void;
}

// 24px hit zone centered on each card edge (visual dot stays small inside).
const SIDE_POSITION_CLASS: Record<ConnectionSide, string> = {
  top: "-top-3 left-1/2 -translate-x-1/2",
  bottom: "-bottom-3 left-1/2 -translate-x-1/2",
  left: "-left-3 top-1/2 -translate-y-1/2",
  right: "-right-3 top-1/2 -translate-y-1/2",
};

const SIDES: ConnectionSide[] = ["top", "right", "bottom", "left"];

export function CanvasResourcePorts({
  resourceId,
  resourceType,
  occupiedSides,
  onStartConnection,
}: CanvasResourcePortsProps) {
  const occupied = new Set(occupiedSides === "" ? [] : occupiedSides.split(","));

  const handlePortPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // Grab the port's exact center so the line always starts at the edge,
    // no matter where inside the hit zone the pointer landed.
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
            className={`group/port absolute ${SIDE_POSITION_CLASS[side]} w-6 h-6 flex items-center justify-center cursor-crosshair transition-opacity duration-150 ${
              isOccupied ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            title={isOccupied ? "Drag another connection" : "Drag to connect"}
            onPointerDown={handlePortPointerDown}
          >
            {isOccupied ? (
              // Plugged socket: dark grommet gripping the line end.
              <span className="w-3.5 h-3.5 rounded-full bg-[#0B0E14] border-2 border-[#3A465C] flex items-center justify-center transition-all duration-150 group-hover/port:border-[#5B8CFF] group-hover/port:scale-110">
                <span className="w-1 h-1 rounded-full bg-[#677185] transition-colors duration-150 group-hover/port:bg-[#5B8CFF]" />
              </span>
            ) : (
              // Free port: accent dot, grows under the pointer.
              <span className="w-2.5 h-2.5 rounded-full bg-[#5B8CFF] ring-2 ring-[#0B0E14] transition-transform duration-150 group-hover/port:scale-125" />
            )}
          </div>
        );
      })}
    </>
  );
}