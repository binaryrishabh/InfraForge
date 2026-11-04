import { FIREWALL_IDLE_SECONDS_MAX, FIREWALL_STATE_HELP, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function FirewallStateSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  return <InspectorSection title="Connection lifetime">
    <Field label="Connection idle timeout (seconds)" hint={FIREWALL_STATE_HELP}>{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={FIREWALL_IDLE_SECONDS_MAX} step={1}
      value={resource.firewallState?.idleTimeoutSeconds ?? ""} placeholder="Until close" disabled={disabled}
      onChange={event => updateResource(resource.id, { firewallState: event.target.value === "" ? undefined : { version: 1, idleTimeoutSeconds: Number(event.target.value) } })} />}</Field>
  </InspectorSection>;
}
