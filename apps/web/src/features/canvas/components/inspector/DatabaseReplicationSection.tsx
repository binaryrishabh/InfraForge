import { DATABASE_REPLICATION_DELAY_MAX_MS, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function DatabaseReplicationSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const policy = resource.databaseReplication;
  return <InspectorSection title="Database HA" hint="Educational async replication. Recent writes can be lost when the replica is promoted.">
    <Field label="Replication" hint="Off uses one writer. One replica receives committed writes later.">
      {({ id, describedBy }) => <select id={id} aria-describedby={describedBy} disabled={disabled} value={policy ? "one" : "off"}
        onChange={event => updateResource(resource.id, { databaseReplication: event.target.value === "off" ? undefined : { version: 1, enabled: true, replicationDelayMs: 1000, readPolicy: "primary" } })}>
        <option value="off">Off</option><option value="one">One replica</option>
      </select>}
    </Field>
    {policy && <>
      <Field label="Modeled replication delay" hint="Milliseconds between a writer commit and replica application; no provider timing claim.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={DATABASE_REPLICATION_DELAY_MAX_MS} step={1} value={policy.replicationDelayMs} disabled={disabled}
          onChange={event => updateResource(resource.id, { databaseReplication: { ...policy, replicationDelayMs: Number(event.target.value) } })} />}
      </Field>
      <Field label="Read policy" hint="Replica preferred can return older versions; unavailable replicas fall back to the writer.">
        {({ id, describedBy }) => <select id={id} aria-describedby={describedBy} disabled={disabled} value={policy.readPolicy}
          onChange={event => updateResource(resource.id, { databaseReplication: { ...policy, readPolicy: event.target.value as "primary" | "replica-preferred" } })}>
          <option value="primary">Primary</option><option value="replica-preferred">Replica preferred</option>
        </select>}
      </Field>
    </>}
  </InspectorSection>;
}
