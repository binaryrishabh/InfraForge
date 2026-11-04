import { resolveServerless, SERVERLESS_RANGES, type ServerlessSettings, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";
const labels = { concurrency: "Concurrent invocations", initializationMs: "Cold initialization (ms)", durationMs: "Invocation body time (ms)", timeoutMs: "Total invocation timeout (ms)", idleExpiryMs: "Warm instance idle expiry (ms)", failurePercent: "Invocation failure (%)" };
export function ServerlessSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const settings = resource.serverless, defaults = resolveServerless();
  const update = (patch: Partial<ServerlessSettings>) => updateResource(resource.id, { serverless: { ...settings, version: 1, ...patch } });
  return <InspectorSection title="Function invocations">
    {Object.entries(SERVERLESS_RANGES).map(([field, [min, max]]) => {
      const key = field as keyof typeof SERVERLESS_RANGES;
      return <Field key={key} label={labels[key]}>{({ id }) => <Input id={id} type="number" step={1} min={min} max={max} disabled={disabled} placeholder={String(defaults[key])} value={settings?.[key] ?? ""} onChange={e => update({ [key]: e.target.value === "" ? undefined : Number(e.target.value) })} />}</Field>;
    })}
    <p className="text-xs text-ink-3">Educational assumed timings: each invocation occupies one instance, reuses a warm idle instance, or initializes a new one; excess concurrency throttles. An attached database shares a connection pool. CPU, memory, provider performance and cost are Unknown.</p>
  </InspectorSection>;
}
