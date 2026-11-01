import { CDN_MAX_WAITERS, CDN_COALESCING_HELP, CDN_WAITERS_HELP, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { Switch } from "@/ui/Switch";
import { updateResource } from "../../actions";

export function CdnCoalescingControls({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const policy = resource.cdnCachePolicy, coalesce = policy?.version === 2 ? policy.coalesce : true;
  return <div className="mt-4 flex flex-col gap-4">
    <Switch label="Coalesce concurrent misses" checked={coalesce} disabled={disabled} description={CDN_COALESCING_HELP}
      onChange={value => updateResource(resource.id, { cdnCachePolicy: { version: 2, coalesce: value,
        ...(policy?.ttlSeconds === undefined ? {} : { ttlSeconds: policy.ttlSeconds }),
        ...(value && policy?.version === 2 && policy.maxWaiters !== undefined ? { maxWaiters: policy.maxWaiters } : {}) } })} />
    {coalesce && <Field label="Shared-fill request limit" hint={CDN_WAITERS_HELP}>
      {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={CDN_MAX_WAITERS} step={1}
        value={policy?.version === 2 ? policy.maxWaiters ?? "" : ""} placeholder="256" disabled={disabled}
        onChange={event => updateResource(resource.id, { cdnCachePolicy: { version: 2, coalesce: true,
          ...(policy?.ttlSeconds === undefined ? {} : { ttlSeconds: policy.ttlSeconds }),
          ...(event.target.value === "" ? {} : { maxWaiters: Number(event.target.value) }) } })} />}
    </Field>}
  </div>;
}
