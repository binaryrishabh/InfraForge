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

// 32px grab zone centered on each card edge.
const SIDE_POSITION_CLASS: Record<ConnectionSide, string> = {
  top: "-top-4 left-1/2 -translate-x-1/2",
  bottom: "-bottom-4 left-1/2 -translate-x-1/2",
  left: "-left-4 top-1/2 -translate-y-1/2",
  right: "-right-4 top-1/2 -translate-y-1/2",
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
            className={`group/port absolute ${SIDE_POSITION_CLASS[side]} w-8 h-8 z-20 flex items-center justify-center cursor-crosshair transition-opacity duration-150 ${
              isOccupied ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            title={isOccupied ? "Drag another connection from this port" : "Drag to connect"}
            onPointerDown={handlePointerDown}
          >
            <span
              className={`flex items-center justify-center rounded-full border-2 bg-[#0B0E14] transition-all duration-150 group-hover/port:scale-125 ${
                isOccupied
                  ? "w-5 h-5 border-[#7AA2FF] shadow-[0_0_10px_rgba(122,162,255,0.55)]"
                  : "w-4 h-4 border-[#5B8CFF]/70 shadow-[0_0_8px_rgba(91,140,255,0.35)] group-hover/port:border-[#7AA2FF] group-hover/port:shadow-[0_0_14px_rgba(122,162,255,0.7)]"
              }`}
            >
              <span
                className={`rounded-full bg-[#7AA2FF] transition-all duration-150 ${
                  isOccupied ? "w-2.5 h-2.5" : "w-2 h-2"
                }`}
              />
            </span>
          </div>
        );
      })}
    </>
  );
}