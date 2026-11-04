import { resolveScheduler, SCHEDULER_RANGES, type SchedulerSettings, type Resource } from "@infraforge/domain/resource";
import { Field, Input, Select } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";
const labels = { startMs: "First trigger (ms)", periodMs: "Period (ms, 0 = One-time)", maxTriggers: "Trigger limit", maxConcurrent: "Concurrent invocations (allow)", queueCapacity: "Waiting invocations (queue)", maxAttempts: "Attempts per trigger", retryDelayMs: "Retry delay (ms)", timeoutMs: "Attempt timeout (ms)", maxLatenessMs: "Maximum lateness (ms)" };
export function SchedulerSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const settings = resource.scheduler, defaults = resolveScheduler();
  const update = (patch: Partial<SchedulerSettings>) => updateResource(resource.id, { scheduler: { ...settings, version: 1, ...patch } });
  return <InspectorSection title="Scheduled invocations">
    {Object.entries(SCHEDULER_RANGES).map(([field, [min, max]]) => {
      const key = field as keyof typeof SCHEDULER_RANGES;
      return <Field key={key} label={labels[key]}>{({ id }) => <Input id={id} type="number" step={1} min={min} max={max} disabled={disabled} placeholder={String(defaults[key])} value={settings?.[key] ?? ""} onChange={e => update({ [key]: e.target.value === "" ? undefined : Number(e.target.value) })} />}</Field>;
    })}
    <Field label="Overlap">{({ id }) => <Select id={id} disabled={disabled} value={settings?.overlap ?? defaults.overlap} onChange={e => update({ overlap: e.target.value as SchedulerSettings["overlap"] })}>{["skip", "allow", "queue"].map(v => <option key={v}>{v}</option>)}</Select>}</Field>
    <Field label="Missed while unavailable">{({ id }) => <Select id={id} disabled={disabled} value={settings?.missed ?? defaults.missed} onChange={e => update({ missed: e.target.value as SchedulerSettings["missed"] })}>{["skip", "latest"].map(v => <option key={v}>{v}</option>)}</Select>}</Field>
    <Field label="App operation">{({ id }) => <Select id={id} disabled={disabled} value={settings?.operation ?? defaults.operation} onChange={e => update({ operation: e.target.value as SchedulerSettings["operation"] })}>{["read", "write"].map(v => <option key={v}>{v}</option>)}</Select>}</Field>
    <p className="text-xs text-ink-3">Educational simulated-time triggers invoke the connected app; exhausted, late or skipped triggers count as missed. Retries can duplicate effects; the destination owns idempotency.</p>
  </InspectorSection>;
}
