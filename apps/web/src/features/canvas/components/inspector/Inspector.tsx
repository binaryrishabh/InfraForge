import { FirewallCapacitySection } from "./FirewallCapacitySection";
import { ObjectCapacitySection } from "./ObjectCapacitySection";
import { SecuritySection } from "./SecuritySection";
import { DataKeyspaceSection } from "./DataKeyspaceSection";
import { VmCpuQuotaSection } from "./VmCpuQuotaSection";
import { VmExecutionSection } from "./VmExecutionSection";
import { DatabaseReplicationSection } from "./DatabaseReplicationSection";
import { DbConcurrencySection } from "./DbConcurrencySection";
import { LbAdmissionSection } from "./LbAdmissionSection";
import { LbHealthSection } from "./LbHealthSection";
import { CachePolicySection } from "./CachePolicySection";
import { MonitoringCadenceSection } from "./MonitoringCadenceSection";
import { MonitoringBufferSection } from "./MonitoringBufferSection";
import { CdnTtlSection } from "./CdnTtlSection";
import { FlowSection } from "./FlowSection";
import { AsyncSection } from "./AsyncSection";
import { CircuitBreakerSection } from "./CircuitBreakerSection";
import { Trash2 } from "lucide-react";
import { RESOURCE_PORTS, RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { Button } from "@/ui/Button";
import { Field, Input } from "@/ui/Field";
import { useCanvasStore } from "../../store/canvasStore";
import { deleteResource, updateResource } from "../../actions";
import { InstanceSection } from "./InstanceSection";
import { RetrySection } from "./RetrySection";
import { AutoscalingSection } from "./AutoscalingSection";
import { ExposureSection } from "./ExposureSection";
import { ConnectionsSection } from "./ConnectionsSection";

/* Properties of the selected resource. While a challenge attempt runs, the
same facts are shown read-only. */
export function Inspector({ resource }: { resource: Resource | undefined }) {
  const locked = useCanvasStore((s) => s.liveLocked || s.isDeploying);
  if (!resource) {
    return (
      <div className="px-4 py-6 text-sm text-ink-3">
        <p className="font-medium text-ink-2">Nothing selected.</p>
        <p className="mt-1">Select a resource on the canvas (click, or Tab to it and press Enter) to see and change its settings.</p>
      </div>
    );
  }
  const sizeable = resource.type === RESOURCE_TYPES.VirtualMachine || resource.type === RESOURCE_TYPES.Database;
  return (
    <div>
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-2">
          <ResourceIcon type={resource.type} size={18} className="" />
        </span>
        <div className="min-w-0">
          <p className="if-eyebrow">{resource.type}</p>
          <p className="truncate text-[16px] font-semibold text-ink">{resource.name || resource.id}</p>
          <p className="if-num truncate text-xs text-ink-3">{resource.id} Ã‚Â· {resource.type === "Firewall" ? "policy attachment" : resource.listenerSettings ? `TCP listeners: ${resource.listenerSettings.ports.join(", ") || "none"}` : `inferred TCP :${RESOURCE_PORTS[resource.type]}`}</p>
        </div>
      </div>
      <div className="px-4 pb-4">
        <Field label="Display name" optional hint="Shown on the canvas and in reports. The id stays the same.">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} value={resource.name ?? ""} placeholder={resource.id} disabled={locked}
              onChange={(event) => updateResource(resource.id, { name: event.target.value.trim() === "" ? undefined : event.target.value })} />
          )}
        </Field>
      </div>
      {resource.type === "Virtual Machine" && <VmCpuQuotaSection key={`vm-cpu-quota-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === "Virtual Machine" && <VmExecutionSection key={`vm-execution-${resource.id}`} resource={resource} disabled={locked} />}
      {sizeable && <InstanceSection key={`size-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === "Database" && <DataKeyspaceSection key={`keyspace-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === "Database" && <DatabaseReplicationSection resource={resource} disabled={locked} />}
      {resource.type === "Database" && <DbConcurrencySection key={`db-concurrency-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === "Firewall" && <FirewallCapacitySection key={`firewall-capacity-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === "Object Storage" && <ObjectCapacitySection key={`object-capacity-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === "Cache" && <CachePolicySection key={`cache-policy-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === "Monitoring Agent" && <MonitoringCadenceSection key={`monitoring-cadence-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === "Monitoring Agent" && <MonitoringBufferSection key={`monitoring-buffer-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === "CDN" && <CdnTtlSection key={`cdn-ttl-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === RESOURCE_TYPES.LoadBalancer && <AutoscalingSection key={`pool-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === RESOURCE_TYPES.LoadBalancer && <LbAdmissionSection key={`admission-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === RESOURCE_TYPES.LoadBalancer && <LbHealthSection key={`health-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === RESOURCE_TYPES.LoadBalancer && <RetrySection key={`retry-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === RESOURCE_TYPES.LoadBalancer && <CircuitBreakerSection key={`breaker-${resource.id}`} resource={resource} disabled={locked} />}
      {(resource.type === "Message Queue" || resource.type === "Virtual Machine") && <AsyncSection key={`async-${resource.id}`} resource={resource} disabled={locked} />}
      {resource.type === "Virtual Machine" && <FlowSection key={`flow-${resource.id}`} resource={resource} disabled={locked} />}
      <SecuritySection key={`security-${resource.id}`} resource={resource} disabled={locked} />
      <ExposureSection key={`exposure-${resource.id}`} resource={resource} disabled={locked} />
      <ConnectionsSection resource={resource} disabled={locked} />
      {!locked && (
        <div className="border-t border-line px-4 py-4">
          <Button variant="quiet-danger" size="sm" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => deleteResource(resource.id)}>Remove from design</Button>
        </div>
      )}
    </div>
  );
}
