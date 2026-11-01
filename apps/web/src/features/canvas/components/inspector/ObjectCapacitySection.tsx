import { OBJECT_STORAGE_CAPACITY_MAX_MIB, OBJECT_STORAGE_CAPACITY_HELP, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function ObjectCapacitySection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  return <InspectorSection title="Object storage">
    <Field label="Stored data capacity (MiB)" hint={OBJECT_STORAGE_CAPACITY_HELP}>{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={OBJECT_STORAGE_CAPACITY_MAX_MIB} step={1}
      value={resource.objectStoragePolicy?.capacityMiB ?? ""} placeholder="Resource profile" disabled={disabled}
      onChange={event => updateResource(resource.id, { objectStoragePolicy: event.target.value === "" ? undefined : { version: 1, capacityMiB: Number(event.target.value) } })} />}</Field>
  </InspectorSection>;
}
