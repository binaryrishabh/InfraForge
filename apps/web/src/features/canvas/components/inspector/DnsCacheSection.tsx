import { DNS_CACHE_MAX_TTL_SECONDS, DNS_CACHE_HELP, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function DnsCacheSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  return <InspectorSection title="DNS resolver cache" hint={DNS_CACHE_HELP}>
    <Field label="Maximum cached TTL (seconds)">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={DNS_CACHE_MAX_TTL_SECONDS} step={1}
      value={resource.dnsCachePolicy?.maxTtlSeconds ?? ""} placeholder="Authority TTL" disabled={disabled}
      onChange={event => updateResource(resource.id, { dnsCachePolicy: event.target.value === "" ? undefined : { version: 1, maxTtlSeconds: Number(event.target.value) } })} />}</Field>
  </InspectorSection>;
}
