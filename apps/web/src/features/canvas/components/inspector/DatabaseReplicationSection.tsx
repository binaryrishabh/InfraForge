import { DATABASE_REPLICATION_DELAY_MAX_MS, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function DatabaseReplicationSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const policy = resource.databaseReplication;
  return <InspectorSection title="Database HA" hint="Educational async replication. Recent writes can be lost when the replica is promoted.">
    <Field label="Replication" hint="Off uses one writer. One replica receives committed writes later.">
      {({ id, describedBy }) => <select id={id} aria-describedby={describedBy} disabled={disabled} value={policy ? "one" : "off"}
        onChange={event => updateResource(resource.id, { ...(event.target.value === "off" ? { databaseReadRouting: undefined } : {}), databaseReplication: event.target.value === "off" ? undefined : { version: 1, enabled: true, replicationDelayMs: 1000, readPolicy: "primary" } })}>
        <option value="off">Off</option><option value="one">One replica</option>
      </select>}
    </Field>
    {policy && <>
      <Field label="Old-primary catch-up" hint="After promotion, the returned primary stays fenced until snapshot and ordered replay finish. Uses the modeled replication delay; recorded promotion loss is retained.">
        {({ id, describedBy }) => <select id={id} aria-describedby={describedBy} disabled={disabled} value={policy.rejoin ?? "off"}
          onChange={event => {
            if (disabled || event.target.value !== "off" && event.target.value !== "snapshot-replay/1") return;
            const nextPolicy = { ...policy };
            if (event.target.value === "off") delete nextPolicy.rejoin;
            else nextPolicy.rejoin = "snapshot-replay/1";
            updateResource(resource.id, { databaseReplication: nextPolicy });
          }}>
          <option value="off">Off (returned primary stays fenced)</option><option value="snapshot-replay/1">Snapshot and ordered replay</option>
        </select>}
      </Field>
      <Field label="Modeled replication delay" hint="Milliseconds between a writer commit and replica application; no provider timing claim.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={DATABASE_REPLICATION_DELAY_MAX_MS} step={1} value={policy.replicationDelayMs} disabled={disabled}
          onChange={event => updateResource(resource.id, { databaseReplication: { ...policy, replicationDelayMs: Number(event.target.value) } })} />}
      </Field>
      <Field label="Read routing" hint="Each member has its own session, query and CPU budget. Replica preferred sends snapshot reads to the replica; only an unavailable replica falls back to the writer. Full capacity refuses work.">
        {({ id, describedBy }) => <select id={id} aria-describedby={describedBy} disabled={disabled} value={resource.databaseReadRouting?.policy ?? "legacy"}
          onChange={event => updateResource(resource.id, { databaseReadRouting: event.target.value === "legacy" ? undefined : { version: 1, policy: event.target.value as "primary-only" | "replica-preferred" } })}>
          <option value="legacy">Saved HA routing</option><option value="primary-only">Primary only</option><option value="replica-preferred">Replica preferred</option>
        </select>}
      </Field>
      {!resource.databaseReadRouting && <Field label="Read policy" hint="Replica preferred can return older versions; unavailable replicas fall back to the writer.">
        {({ id, describedBy }) => <select id={id} aria-describedby={describedBy} disabled={disabled} value={policy.readPolicy}
          onChange={event => updateResource(resource.id, { databaseReplication: { ...policy, readPolicy: event.target.value as "primary" | "replica-preferred" } })}>
          <option value="primary">Primary</option><option value="replica-preferred">Replica preferred</option>
        </select>}
      </Field>}
    </>}
  </InspectorSection>;
}
