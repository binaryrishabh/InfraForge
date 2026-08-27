import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Resource } from "@shared/interface/Resource.interface";
import { ManhattanConnectionLine } from "@/features/canvas/components/ManhattanConnectionLine";
import { MonitoringResourceNode } from "./MonitoringResourceNode";

interface ReadOnlyCanvasProps {
  resources: Resource[];
  connectionLines: ConnectionLine[];
}

export function ReadOnlyCanvas({ resources, connectionLines }: ReadOnlyCanvasProps) {
  return (
    <div className="relative w-full h-full bg-[#0f1117] rounded-lg border border-gray-800 overflow-hidden">
      <svg className="absolute inset-0 pointer-events-none z-10" width="100%" height="100%">
        {connectionLines.map(connectionLine => {
          const source = resources.find(resource => resource.id === connectionLine.sourceId);
          const target = resources.find(resource => resource.id === connectionLine.targetId);
          if (!source || !target) return null;
          return <ManhattanConnectionLine key={connectionLine.id} source={source} target={target} port={connectionLine.port} />;
        })}
      </svg>
      {resources.map(resource => (
        <MonitoringResourceNode key={resource.id} resource={resource} />
      ))}
    </div>
  );
}