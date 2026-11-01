import { findSku } from "@infraforge/catalog";
import { VM_WORKERS_MAX, VM_QUEUED_REQUESTS_MAX, type VmExecution, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function VmExecutionSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  if (resource.asyncWorker?.enabled) return <InspectorSection title="VM execution" hint="This VM runs queue jobs; its concurrency is set under Background worker.">{null}</InspectorSection>;
  const cores = (resource.skuId ? findSku(resource.skuId)?.vCpu : undefined) ?? { small: 1, medium: 2, large: 4 }[resource.size ?? "small"];
  const commit = (field: "workers" | "queuedRequests", value: string) => {
    const next: VmExecution = { version: 1, ...resource.vmExecution, [field]: value === "" ? undefined : Number(value) };
    updateResource(resource.id, { vmExecution: next.workers === undefined && next.queuedRequests === undefined ? undefined : next });
  };
  return <InspectorSection title="VM execution" hint="Active workers process requests. Extra requests wait in this queue. When both are full, new work is refused.">
    <div className="flex flex-col gap-4">
      <Field label="Active workers">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={VM_WORKERS_MAX} step={1}
          value={resource.vmExecution?.workers ?? ""} placeholder={`Default (${4 * cores})`} disabled={disabled}
          onChange={event => commit("workers", event.target.value)} />}
      </Field>
      <Field label="Queued requests">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} max={VM_QUEUED_REQUESTS_MAX} step={1}
          value={resource.vmExecution?.queuedRequests ?? ""} placeholder="Default (256)" disabled={disabled}
          onChange={event => commit("queuedRequests", event.target.value)} />}
      </Field>
    </div>
  </InspectorSection>;
}
