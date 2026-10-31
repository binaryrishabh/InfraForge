import { DATA_KEYSPACE_MAX, type Resource } from "@infraforge/domain/resource";
import { Field, Select } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function DataKeyspaceSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const count = resource.dataKeyspace?.count ?? 1;
  const choices = [...new Set([1, 10, 100, DATA_KEYSPACE_MAX, count])].sort((a, b) => a - b);
  return <InspectorSection title="Application data">
    <Field label="Data keyspace" hint="Number of distinct application data keys used by this workload.">
      {({ id, describedBy }) => <Select id={id} aria-describedby={describedBy} value={count} disabled={disabled}
        onChange={event => updateResource(resource.id, { dataKeyspace: { version: 1, count: Number(event.target.value) } })}>
        {choices.map(value => <option key={value} value={value}>{value.toLocaleString("en-US")}</option>)}
      </Select>}
    </Field>
  </InspectorSection>;
}
