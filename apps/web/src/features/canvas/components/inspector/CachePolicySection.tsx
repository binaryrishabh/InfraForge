import { CACHE_TTL_MAX_SECONDS, CACHE_CAPACITY_MAX_ENTRIES, type CachePolicy, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { Switch } from "@/ui/Switch";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function CachePolicySection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const commit = (patch: Partial<Pick<CachePolicy, "ttlSeconds" | "singleFlight">>) => updateResource(resource.id, { cachePolicy: { version: 1, ...resource.cachePolicy, ...patch } });
  const capacity = (value: string) => {
    const { ttlSeconds, singleFlight } = resource.cachePolicy ?? {};
    const policy: CachePolicy = value === "" ? { version: 1, ttlSeconds, singleFlight } : { version: 2, capacityEntries: Number(value), ttlSeconds, singleFlight };
    updateResource(resource.id, { cachePolicy: policy });
  };
  return <InspectorSection title="Cache behavior">
    <div className="flex flex-col gap-4">
      <Field label="Cache TTL" hint="Seconds an entry remains cached after a successful fill. Default: 60 seconds.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={CACHE_TTL_MAX_SECONDS} step={1}
          value={resource.cachePolicy?.ttlSeconds ?? 60} disabled={disabled}
          onChange={event => commit({ ttlSeconds: event.target.value === "" ? undefined : Number(event.target.value) })} />}
      </Field>
      <Field label="Logical cache capacity" hint="Educational entry budget, including modeled row bytes and per-entry overhead; provider memory is unknown. Leave blank for the existing size assumption.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={CACHE_CAPACITY_MAX_ENTRIES} step={1} placeholder="Default"
          value={resource.cachePolicy?.version === 2 ? resource.cachePolicy.capacityEntries : ""} disabled={disabled}
          onChange={event => capacity(event.target.value)} />}
      </Field>
      <Switch label="Single-flight" checked={resource.cachePolicy?.singleFlight === true} disabled={disabled}
        onChange={singleFlight => commit({ singleFlight })}
        description="When enabled, concurrent misses for the same key share one database fill instead of independently hitting the database." />
    </div>
  </InspectorSection>;
}
