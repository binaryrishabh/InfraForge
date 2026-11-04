import { SchedulerReadings } from "./SchedulerReadings";
import { VmMemoryReadings } from "./VmMemoryReadings";
import { LbRateLimitReadings } from "./LbRateLimitReadings";
import { RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { HealthMark } from "@/ui/HealthMark";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { MeterRow } from "@/features/canvas/components/node/MeterRow";
import { AsyncQueueReadings } from "@/features/canvas/components/inspector/AsyncSection";
import { SecurityReadings } from "@/features/canvas/components/inspector/SecuritySection";
import { DatabaseReplicationReadings } from "./DatabaseReplicationReadings";
import { DataDeliveryReadings } from "./DataDeliveryReadings";
import { ObservabilityReadings } from "./ObservabilityReadings";
import { CHAOS_LABELS } from "@/features/monitoring/chaosLabels";
import { FaultControl } from "./controls/FaultControl";
import { PoolControl } from "./controls/PoolControl";
import { plural } from "@/lib/format";

/* Live facts for the selected resource, then the controls that act on it
(freeform runs only). */
export function NodeLive({ deploymentId, resource, resources, controls, ended = false }: { deploymentId: string; resource: Resource | undefined; resources: Resource[]; controls: boolean; ended?: boolean }) {
  const metric = useSimulationStore((s) => (resource ? s.metrics[resource.id] : undefined));
  const activeChaos = useSimulationStore((s) => s.activeChaos);
  const effects = activeChaos.filter(c => c.resourceId === resource?.id);
  const restarting = useSimulationStore((s) => !!resource && s.restarting.includes(resource.id));
  if (!resource) return <p className="px-4 py-6 text-sm text-ink-3">Select a resource on the canvas (or Tab to it and press Enter) to see its live measurements.</p>;
  return (
    <div>
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-raised text-ink-2"><ResourceIcon type={resource.type} size={18} className="" /></span>
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
          <p className="if-num mt-1 flex justify-between text-xs text-ink-2"><span>{metric.rps ?? "Unknown"} requests/s</span>{metric.connections !== undefined && <span>{plural(metric.connections, "connection")}</span>}</p>
        </>}
        {effects.map((chaos, index) => <p key={chaos.intervention?.actionId ?? index} className="if-num mt-1 text-xs font-semibold text-fail">Fault active: {(chaos.intervention ? `${chaos.intervention.label} ${JSON.stringify(chaos.intervention.parameters)}; restores at ${chaos.intervention.restoreAtUs} us` : CHAOS_LABELS[chaos.chaosType!])} · {chaos.remainingTicks} s left</p>)}
        {restarting && <p className="if-num mt-1 text-xs font-semibold text-warn">Restarting on a new size</p>}
      </div>
      {resource.type === "Virtual Machine" && !resource.asyncWorker?.enabled && <VmMemoryReadings metrics={metric?.vmMemory} />}
      {resource.type === "Database" && <DatabaseReplicationReadings metrics={metric} />}
      {(resource.lbRateLimit || metric?.rateLimit) && <LbRateLimitReadings metrics={metric?.rateLimit} />}
      <DataDeliveryReadings type={resource.type} metrics={metric} />
      {resource.type === "Scheduler" && <SchedulerReadings metrics={metric?.scheduler} />}
      {resource.type === "Event Bus" && <EventBusReadings metrics={metric?.eventBus} />}
      {resource.type === "API Gateway" && <GatewayReadings metrics={metric?.gateway} />}
      <ObservabilityReadings type={resource.type} metrics={metric} />
      {(resource.asyncQueue?.enabled || metric?.asyncQueue) && <section aria-label="Upload queue measurements" className="border-b border-line px-4 py-4"><AsyncQueueReadings metrics={metric?.asyncQueue} /></section>}
      {(resource.type === RESOURCE_TYPES.Firewall || resource.listenerSettings || metric?.security) && <section aria-label="Security measurements" className="border-b border-line px-4 py-4 text-sm"><SecurityReadings metrics={metric?.security} firewall={resource.type === RESOURCE_TYPES.Firewall} /></section>}
      {controls && <>
        {resource.type === RESOURCE_TYPES.LoadBalancer && <PoolControl deploymentId={deploymentId} only={resource.id} />}
        {(resource.type === RESOURCE_TYPES.VirtualMachine || resource.type === RESOURCE_TYPES.Database) && <p className="px-4 py-3 text-sm text-ink-3">Resizing during a Model 2 run is unavailable. Stop, change the size in the designer and start a new run.</p>}
        <FaultControl deploymentId={deploymentId} resources={resources} fixedTarget={resource.id} />
      </>}
    </div>
  );
}
import { EventBusReadings } from "./EventBusReadings";
import { GatewayReadings } from "./GatewayReadings";
