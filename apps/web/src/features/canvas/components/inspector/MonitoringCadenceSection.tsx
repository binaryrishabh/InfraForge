import { MONITORING_CADENCE_MAX_SECONDS, MONITORING_COLLECTION_HELP, MONITORING_EXPORT_HELP, MONITORING_CADENCE_SCOPE, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function MonitoringCadenceSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  return <InspectorSection title="Monitoring cadence" hint={MONITORING_CADENCE_SCOPE}>
    {([ ["collectionIntervalSeconds", "Collect every (seconds)", MONITORING_COLLECTION_HELP], ["exportIntervalSeconds", "Export every (seconds)", MONITORING_EXPORT_HELP] ] as const).map(([field, label, help]) =>
      <Field key={field} label={label} hint={help}>{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={MONITORING_CADENCE_MAX_SECONDS} step={1}
        value={resource.monitoringPolicy?.[field] ?? ""} placeholder="10" disabled={disabled}
        onChange={event => {
          const policy = { ...resource.monitoringPolicy, version: 1 as const };
          if (event.target.value === "") delete policy[field]; else policy[field] = Number(event.target.value);
          updateResource(resource.id, { monitoringPolicy: policy.collectionIntervalSeconds === undefined && policy.exportIntervalSeconds === undefined ? undefined : policy });
        }} />}</Field>)}
  </InspectorSection>;
}
