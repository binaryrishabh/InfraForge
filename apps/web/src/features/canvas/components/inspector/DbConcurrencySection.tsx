import { findSku } from "@infraforge/catalog";
import { DB_ACTIVE_QUERIES_MAX, DB_QUEUED_QUERIES_MAX, type DbConcurrency, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function DbConcurrencySection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const cores = (resource.skuId ? findSku(resource.skuId)?.vCpu : undefined) ?? { small: 1, medium: 2, large: 4 }[resource.size ?? "small"];
  const commit = (field: "activeQueries" | "queuedQueries", value: string) => {
    const next: DbConcurrency = { version: 1, ...resource.dbConcurrency, [field]: value === "" ? undefined : Number(value) };
    updateResource(resource.id, { dbConcurrency: next.activeQueries === undefined && next.queuedQueries === undefined ? undefined : next });
  };
  return <InspectorSection title="Database concurrency" hint="Active queries can execute at once. Extra queries wait in the database queue up to this limit.">
    <div className="flex flex-col gap-4">
      <Field label="Active queries" hint="Leave blank for the existing size assumption.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={DB_ACTIVE_QUERIES_MAX} step={1}
          value={resource.dbConcurrency?.activeQueries ?? ""} placeholder={`Default (${16 * cores})`} disabled={disabled}
          onChange={event => commit("activeQueries", event.target.value)} />}
      </Field>
      <Field label="Queued queries" hint="Zero refuses extra queries when all active slots are busy. Leave blank for the existing limit.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} max={DB_QUEUED_QUERIES_MAX} step={1}
          value={resource.dbConcurrency?.queuedQueries ?? ""} placeholder="Default (256)" disabled={disabled}
          onChange={event => commit("queuedQueries", event.target.value)} />}
      </Field>
    </div>
  </InspectorSection>;
}
