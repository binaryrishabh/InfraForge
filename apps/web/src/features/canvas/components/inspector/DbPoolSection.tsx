import { useState } from "react";
import { DB_POOL_MAX_CONNECTIONS, dbPoolError, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function parseDbPool(text: string) {
  const value = text === "" ? undefined : Number(text);
  const error = text !== "" && text.trim() === "" ? "Enter a whole number from 1 to 512, or leave blank for 10." : dbPoolError("Database", value);
  return { value, error };
}
export function DbPoolSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const saved = resource.dbPoolMaxConnections;
  const [draft, setDraft] = useState({ saved, text: saved === undefined ? "" : String(saved) });
  if (draft.saved !== saved) setDraft({ saved, text: saved === undefined ? "" : String(saved) });
  return <DbPoolEditor resource={resource} disabled={disabled} text={draft.text} onText={text => setDraft({ saved, text })} />;
}
export function DbPoolEditor({ resource, disabled, text, onText }: { resource: Resource; disabled: boolean; text: string; onText: (text: string) => void }) {
  const parsed = parseDbPool(text);
  return <InspectorSection title="Application connection pool" hint="Bounds each application's connections to this database, per VM replica and database path. Functions share their source path. This is separate from the database's own session limit and Active queries.">
    <Field label="Application database connections" hint="Whole number from 1 to 512. Leave blank for the existing maximum of 10." error={parsed.error}>
      {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={1} max={DB_POOL_MAX_CONNECTIONS} step={1} disabled={disabled} value={text} placeholder="Default (10)"
        onChange={e => { if (disabled) return; onText(e.target.value); const next = parseDbPool(e.target.value); if (!next.error) updateResource(resource.id, { dbPoolMaxConnections: next.value }); }} />}
    </Field>
  </InspectorSection>;
}
