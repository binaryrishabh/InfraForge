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

// 40px grab zone centered on each card edge — invisible, generous target.
const SIDE_POSITION_CLASS: Record<ConnectionSide, string> = {
  top: "-top-5 left-1/2 -translate-x-1/2",
  bottom: "-bottom-5 left-1/2 -translate-x-1/2",
  left: "-left-5 top-1/2 -translate-y-1/2",
  right: "-right-5 top-1/2 -translate-y-1/2",
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
            className={`group/port absolute ${SIDE_POSITION_CLASS[side]} w-10 h-10 z-20 flex items-center justify-center cursor-crosshair transition-opacity duration-150 ${
              isOccupied ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            title={isOccupied ? "Drag another connection from this port" : "Drag to connect"}
            onPointerDown={handlePointerDown}
          >
            {/* Aura bloom — soft halo that opens behind the port on hover */}
            <span className="absolute w-9 h-9 rounded-full bg-[rgba(91,140,255,0.12)] scale-50 opacity-0 transition-all duration-150 group-hover/port:scale-100 group-hover/port:opacity-100" />
            {/* Flange — thin outer ring marking a plugged connector */}
            {isOccupied && (
              <span className="absolute w-9 h-9 rounded-full border border-[rgba(122,162,255,0.30)]" />
            )}
            {/* Port ring — dark core, accent wall, breathing glow when plugged */}
            <span
              className={`relative flex items-center justify-center rounded-full border-2 bg-[#0B0E14] transition-all duration-150 group-hover/port:scale-110 ${
                isOccupied
                  ? "w-7 h-7 border-[#7AA2FF] infraforge-port-pulse"
                  : "w-6 h-6 border-[#5B8CFF]/70 shadow-[0_0_8px_rgba(91,140,255,0.35)] group-hover/port:border-[#7AA2FF] group-hover/port:shadow-[0_0_16px_rgba(122,162,255,0.70)]"
              }`}
            >
              <span
                className={`rounded-full transition-all duration-150 ${
                  isOccupied
                    ? "w-3.5 h-3.5 bg-[#A8C4FF]"
                    : "w-2.5 h-2.5 bg-[#5B8CFF] group-hover/port:bg-[#A8C4FF]"
                }`}
              />
            </span>
          </div>
        );
      })}
    </>
  );
}