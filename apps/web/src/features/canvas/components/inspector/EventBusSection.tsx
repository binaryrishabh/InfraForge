import { resolveEventBus, type EventBusSettings, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { useCanvasStore } from "../../store/canvasStore";
import { InspectorSection } from "./InspectorSection";

const fields = [["capacityMessages", "Pending events per subscription", 1, 10000], ["maxAttempts", "Delivery attempts", 1, 10], ["retryDelayMs", "Retry delay (ms)", 1, 60000], ["deliveryTimeoutMs", "Delivery timeout (ms)", 1, 60000], ["deadLetterCapacity", "Dead letters per subscription", 0, 10000]] as const;
export function EventBusSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const connections = useCanvasStore(s => s.connectionLines).filter(e => e.sourceId === resource.id);
  const settings = resource.eventBus, defaults = resolveEventBus();
  const update = (patch: Partial<EventBusSettings>) => updateResource(resource.id, { eventBus: { ...settings, version: 1, ...patch } });
  const filter = (edgeId: string, value: string) => update({ subscriptions: connections.map(edge => {
    const saved = settings?.subscriptions?.find(s => s.edge === edge.id);
    const prefix = edge.id === edgeId ? value : saved?.filter?.keyPrefix;
    return { id: saved?.id ?? edge.id, edge: edge.id, ...(prefix ? { filter: { keyPrefix: prefix } } : {}) };
  }) });
  return <InspectorSection title="Event subscriptions">
    {fields.map(([key, label, min, max]) => <Field key={key} label={label}>{({ id }) => <Input id={id} type="number" step={1} min={min} max={max} disabled={disabled} placeholder={String(defaults[key])} value={settings?.[key] ?? ""} onChange={e => update({ [key]: e.target.value === "" ? undefined : Number(e.target.value) })} />}</Field>)}
    {connections.map(edge => <Field key={edge.id} label={`Key prefix for ${edge.targetId}`}>{({ id }) => <Input id={id} disabled={disabled} maxLength={128} placeholder="All events" value={settings?.subscriptions?.find(s => s.edge === edge.id)?.filter?.keyPrefix ?? ""} onChange={e => filter(edge.id, e.target.value)} />}</Field>)}
    <p className="text-xs text-ink-3">Each connected queue receives independently; a full subscription discards its copy. Retries can duplicate delivery. Ordering and physical durability are Unknown.</p>
  </InspectorSection>;
}
