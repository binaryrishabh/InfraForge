import { VM_CPU_LIMIT_MAX, VM_CPU_QUOTA_HELP, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function VmCpuQuotaSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  if (resource.asyncWorker?.enabled) return <InspectorSection title="Application CPU limit" hint="This VM runs queue jobs; application CPU quota is available only for request-serving VMs.">{null}</InspectorSection>;
  return <InspectorSection title="Application CPU limit" hint={`${VM_CPU_QUOTA_HELP} Fixed window: 100 ms. Percentage of total modeled CPU capacity (50% of 2 cores averages 1 core). Worker count, CPU cores, queue size and quota are separate. Blank means no quota.`}>
    <Field label="Application CPU limit (%)">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={VM_CPU_LIMIT_MAX} step={1}
      value={resource.vmCpuQuota?.limitPercent ?? ""} placeholder="No quota" disabled={disabled}
      onChange={event => updateResource(resource.id, { vmCpuQuota: event.target.value === "" ? undefined : { version: 1, limitPercent: Number(event.target.value) } })} />}</Field>
  </InspectorSection>;
}
