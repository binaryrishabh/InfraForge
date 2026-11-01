import { CDN_TTL_MAX_SECONDS, CDN_TTL_HELP, CDN_TTL_SCOPE, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { CdnCoalescingControls } from "./CdnCoalescingControls";
import { InspectorSection } from "./InspectorSection";

export function CdnTtlSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  return <InspectorSection title="CDN cache" hint={`${CDN_TTL_HELP} ${CDN_TTL_SCOPE}`}>
    <Field label="Cache TTL (seconds)">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={CDN_TTL_MAX_SECONDS} step={1}
      value={resource.cdnCachePolicy?.ttlSeconds ?? ""} placeholder="60" disabled={disabled}
      onChange={event => {
        const ttlSeconds = event.target.value === "" ? undefined : Number(event.target.value);
        updateResource(resource.id, { cdnCachePolicy: resource.cdnCachePolicy?.version === 2
          ? { ...resource.cdnCachePolicy, ttlSeconds } : ttlSeconds === undefined ? undefined : { version: 1, ttlSeconds } });
      }} />}</Field>
    <CdnCoalescingControls resource={resource} disabled={disabled} />
  </InspectorSection>;
}
