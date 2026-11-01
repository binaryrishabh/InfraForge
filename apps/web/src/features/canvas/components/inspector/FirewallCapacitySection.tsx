import { FIREWALL_FLOW_CAPACITY_MAX, FIREWALL_FLOW_CAPACITY_HELP, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function FirewallCapacitySection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  return <InspectorSection title="Connection tracking">
    <Field label="Tracked connection limit" hint={FIREWALL_FLOW_CAPACITY_HELP}>{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={FIREWALL_FLOW_CAPACITY_MAX} step={1}
      value={resource.firewallCapacity?.maxFlows ?? ""} placeholder="10000 × modeled cores" disabled={disabled}
      onChange={event => updateResource(resource.id, { firewallCapacity: event.target.value === "" ? undefined : { version: 1, maxFlows: Number(event.target.value) } })} />}</Field>
  </InspectorSection>;
}
