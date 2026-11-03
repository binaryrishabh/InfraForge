import type { Resource, LbSelection } from "@infraforge/domain/resource";
import { Field, Select } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function LbSelectionSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  return <InspectorSection title="Backend selection" hint="Round robin takes turns; least outstanding chooses the server with the fewest unfinished requests. Blank keeps round robin.">
    <Field label="Selection policy">
      {({ id, describedBy }) => <Select id={id} aria-describedby={describedBy} value={resource.lbSelection?.policy ?? ""} disabled={disabled}
        onChange={event => updateResource(resource.id, { lbSelection: event.target.value === "" ? undefined : { version: 1, policy: event.target.value as LbSelection["policy"] } })}>
        <option value="">Default (round robin)</option>
        <option value="round-robin">Round robin</option>
        <option value="least-outstanding">Least outstanding</option>
      </Select>}
    </Field>
  </InspectorSection>;
}
