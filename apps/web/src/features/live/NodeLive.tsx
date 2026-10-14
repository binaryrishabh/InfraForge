import { RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { categoryColor } from "@/theme/categories";
import { HealthMark } from "@/ui/HealthMark";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { MeterRow } from "@/features/canvas/components/node/MeterRow";
import { CHAOS_LABELS } from "@/features/monitoring/chaosLabels";
import { FaultControl } from "./controls/FaultControl";
import { ResizeControl } from "./controls/ResizeControl";
import { PoolControl } from "./controls/PoolControl";
import { plural } from "@/lib/format";

/* Live facts for the selected resource, then the controls that act on it
(freeform runs only). */
export function NodeLive({ deploymentId, resource, resources, controls, ended = false }: { deploymentId: string; resource: Resource | undefined; resources: Resource[]; controls: boolean; ended?: boolean }) {
  const metric = useSimulationStore((s) => (resource ? s.metrics[resource.id] : undefined));
  const chaos = useSimulationStore((s) => (resource ? s.activeChaos.find((c) => c.resourceId === resource.id) : undefined));
  const restarting = useSimulationStore((s) => !!resource && s.restarting.includes(resource.id));
  if (!resource) return <p className="px-4 py-6 text-sm text-ink-3">Select a resource on the canvas (or Tab to it and press Enter) to see its live measurements.</p>;
  return (
    <div>
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-raised" style={{ color: categoryColor(resource.type) }}><ResourceIcon type={resource.type} size={18} className="" /></span>
        <div className="min-w-0 flex-1">
          <p className="if-eyebrow">{resource.type}</p>
          <p className="truncate text-[16px] font-semibold text-ink">{resource.name || resource.id}</p>
          <p className="if-num text-xs text-ink-3">{resource.skuId ?? "generic size"}</p>
        </div>
        {metric && <HealthMark value={metric.health} />}
      </div>
      <div className="flex flex-col gap-1.5 border-b border-line px-4 pb-4">
        {!metric ? <p role="status" className="text-sm text-ink-3">{ended ? "This run has ended. Its recorded final measurements are in the report." : "No measurement yet."}</p> : <>
          <MeterRow label="CPU" value={metric.cpu} />
          <MeterRow label="MEM" value={metric.memory} />
          <p className="if-num mt-1 flex justify-between text-xs text-ink-2"><span>{metric.rps ?? 0} requests/s</span>{metric.connections !== undefined && <span>{plural(metric.connections, "connection")}</span>}</p>
        </>}
        {chaos && <p className="if-num mt-1 text-xs font-semibold text-fail">Fault active: {CHAOS_LABELS[chaos.chaosType]} · {chaos.remainingTicks} s left</p>}
        {restarting && <p className="if-num mt-1 text-xs font-semibold text-warn">Restarting on a new size</p>}
      </div>
      {controls && <>
        {resource.type === RESOURCE_TYPES.LoadBalancer && <PoolControl deploymentId={deploymentId} only={resource.id} />}
        {(resource.type === RESOURCE_TYPES.VirtualMachine || resource.type === RESOURCE_TYPES.Database) && <ResizeControl deploymentId={deploymentId} resources={resources} fixedTarget={resource.id} />}
        <FaultControl deploymentId={deploymentId} resources={resources} fixedTarget={resource.id} />
      </>}
    </div>
  );
}
