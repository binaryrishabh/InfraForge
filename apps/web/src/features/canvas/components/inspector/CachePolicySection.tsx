import { CACHE_TTL_MAX_SECONDS, type CachePolicy, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { Switch } from "@/ui/Switch";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function CachePolicySection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const commit = (patch: Partial<CachePolicy>) => updateResource(resource.id, { cachePolicy: { ...resource.cachePolicy, version: 1, ...patch } });
  return <InspectorSection title="Cache behavior">
    <div className="flex flex-col gap-4">
      <Field label="Cache TTL" hint="Seconds an entry remains cached after a successful fill. Default: 60 seconds.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={CACHE_TTL_MAX_SECONDS} step={1}
          value={resource.cachePolicy?.ttlSeconds ?? 60} disabled={disabled}
          onChange={event => commit({ ttlSeconds: event.target.value === "" ? undefined : Number(event.target.value) })} />}
      </Field>
      <Switch label="Single-flight" checked={resource.cachePolicy?.singleFlight === true} disabled={disabled}
        onChange={singleFlight => commit({ singleFlight })}
        description="When enabled, concurrent misses for the same key share one database fill instead of independently hitting the database." />
    </div>
  </InspectorSection>;
}
