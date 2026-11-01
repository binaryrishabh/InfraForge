import { findSku } from "@infraforge/catalog";
import { LB_ACTIVE_MAX, LB_QUEUED_MAX, LB_QUEUE_WAIT_MAX_MS, type LbAdmission, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function LbAdmissionSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const cores = (resource.skuId ? findSku(resource.skuId)?.vCpu : undefined) ?? { small: 1, medium: 2, large: 4 }[resource.size ?? "small"];
  const commit = (field: "maxActive" | "maxQueued" | "queueWaitMs", value: string) => {
    const next: LbAdmission = { version: 1, ...resource.lbAdmission, [field]: value === "" ? undefined : Number(value) };
    updateResource(resource.id, { lbAdmission: next.maxActive === undefined && next.maxQueued === undefined && next.queueWaitMs === undefined ? undefined : next });
  };
  return <InspectorSection title="Load balancer admission" hint="Active requests are forwarded at once; queued requests wait for a free slot until the queue wait expires. Blank keeps the default.">
    <div className="flex flex-col gap-4">
      <Field label="Active requests">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={LB_ACTIVE_MAX} step={1}
          value={resource.lbAdmission?.maxActive ?? ""} placeholder={`Default (${1024 * cores})`} disabled={disabled}
          onChange={event => commit("maxActive", event.target.value)} />}
      </Field>
      <Field label="Queued requests">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} max={LB_QUEUED_MAX} step={1}
          value={resource.lbAdmission?.maxQueued ?? ""} placeholder="Default (256)" disabled={disabled}
          onChange={event => commit("maxQueued", event.target.value)} />}
      </Field>
      <Field label="Queue wait (ms)">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={LB_QUEUE_WAIT_MAX_MS} step={1}
          value={resource.lbAdmission?.queueWaitMs ?? ""} placeholder="Default (1000)" disabled={disabled}
          onChange={event => commit("queueWaitMs", event.target.value)} />}
      </Field>
    </div>
  </InspectorSection>;
}
