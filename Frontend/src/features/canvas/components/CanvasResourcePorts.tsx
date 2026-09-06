import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

interface CanvasResourcePortsProps {
  resourceId: string;
  resourceType: ResourceType;
  onStartConnection: (
    sourceId: string,
    sourceType: ResourceType,
    clientX: number,
    clientY: number
  ) => void;
}

export function CanvasResourcePorts({
  resourceId,
  resourceType,
  onStartConnection,
}: CanvasResourcePortsProps) {
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onStartConnection(resourceId, resourceType, e.clientX, e.clientY);
  };

  return (
    <>
      {/* Top port */}
      <div
        className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair"
        title="Port"
        onPointerDown={handlePointerDown}
      />
      {/* Right port */}
      <div
        className="absolute -right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair"
        title="Port"
        onPointerDown={handlePointerDown}
      />
      {/* Bottom port */}
      <div
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair"
        title="Port"
        onPointerDown={handlePointerDown}
      />
      {/* Left port */}
      <div
        className="absolute -left-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair"
        title="Port"
        onPointerDown={handlePointerDown}
      />
    </>
  );
}