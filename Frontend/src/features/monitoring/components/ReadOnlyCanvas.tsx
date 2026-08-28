import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { useSimulationStore } from "../store/simulationStore";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Resource } from "@shared/interface/Resource.interface";
import { ManhattanConnectionLine } from "@/features/canvas/components/ManhattanConnectionLine";
import { MonitoringResourceNode } from "./MonitoringResourceNode";
import { ProvisioningNode } from "./ProvisioningNode";

interface ReadOnlyCanvasProps {
  resources: Resource[];
  connectionLines: ConnectionLine[];
}

export function ReadOnlyCanvas({ resources, connectionLines }: ReadOnlyCanvasProps) {
  const spawnedVms = useSimulationStore((s) => s.spawnedVms);

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
      {spawnedVms
        .filter(v => v.status === "active")
        .map(v => (
          <MonitoringResourceNode
            key={v.id}
            resource={{
              id: v.id,
              type: RESOURCE_TYPES.VirtualMachine,
              x: v.x,
              y: v.y
            }}
          />
        ))}
      {spawnedVms
        .filter(v => v.status === "provisioning")
        .map(v => (
          <ProvisioningNode key={v.id} vm={v} />
        ))}
    </div>
  );
}