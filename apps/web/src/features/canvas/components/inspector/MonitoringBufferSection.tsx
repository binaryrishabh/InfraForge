import { MONITORING_BUFFER_MAX_SAMPLES, MONITORING_EXPORT_MAX_ATTEMPTS, MONITORING_BUFFER_HELP, MONITORING_BATCH_HELP, MONITORING_ATTEMPTS_HELP, type Resource, type MonitoringPolicy } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function MonitoringBufferSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const p = resource.monitoringPolicy, buffer = p?.version === 2 ? p : undefined;
  return <InspectorSection title="Monitoring buffer">
    {([
      ["bufferSamples", "Buffered samples", 1000, MONITORING_BUFFER_MAX_SAMPLES, MONITORING_BUFFER_HELP],
      ["batchSamples", "Export batch size", 100, buffer?.bufferSamples ?? 1000, MONITORING_BATCH_HELP],
      ["exportAttempts", "Export attempts", 2, MONITORING_EXPORT_MAX_ATTEMPTS, MONITORING_ATTEMPTS_HELP],
    ] as const).map(([field, label, fallback, max, help]) =>
      <Field key={field} label={label} hint={help}>{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={max} step={1}
        value={buffer?.[field] ?? ""} placeholder={String(fallback)} disabled={disabled}
        onChange={event => {
          const policy: MonitoringPolicy = { ...p, version: 2, bufferSamples: buffer?.bufferSamples ?? 1000, batchSamples: buffer?.batchSamples ?? 100, exportAttempts: buffer?.exportAttempts ?? 2 };
          policy[field] = event.target.value === "" ? fallback : Number(event.target.value);
          if (event.target.value === "" && policy.bufferSamples === 1000 && policy.batchSamples === 100 && policy.exportAttempts === 2) {
            const { collectionIntervalSeconds, exportIntervalSeconds } = policy;
            updateResource(resource.id, { monitoringPolicy: collectionIntervalSeconds === undefined && exportIntervalSeconds === undefined ? undefined : { version: 1, ...(collectionIntervalSeconds === undefined ? {} : { collectionIntervalSeconds }), ...(exportIntervalSeconds === undefined ? {} : { exportIntervalSeconds }) } });
          } else updateResource(resource.id, { monitoringPolicy: policy });
        }} />}</Field>)}
  </InspectorSection>;
}
