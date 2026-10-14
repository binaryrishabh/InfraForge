import { useState } from "react";
import type { Resource } from "@infraforge/domain/resource";
import { Switch } from "@/ui/Switch";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

function parsePorts(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const ports = parts.map(Number);
  return ports.every((p) => Number.isInteger(p) && p >= 0 && p <= 65535) ? [...new Set(ports)] : null;
}

/* Exposure settings feed the deployment's security scan. They do not change
capacity in this model. */
export function ExposureSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const [ports, setPorts] = useState((resource.openPorts ?? []).join(", "));
  const parsed = parsePorts(ports);
  return (
    <InspectorSection title="Exposure" hint="Checked by the security scan when a run starts.">
      <div className="flex flex-col gap-4">
        <Switch checked={!!resource.public} disabled={disabled} label="Publicly reachable" description="Reachable from the internet."
          onChange={(value) => updateResource(resource.id, { public: value || undefined })} />
        <Switch checked={!!resource.encryption} disabled={disabled} label="Encryption" description="Traffic to this resource is encrypted."
          onChange={(value) => updateResource(resource.id, { encryption: value || undefined })} />
        <Field label="Open ports" optional error={parsed ? null : "Use whole numbers from 0 to 65535, separated by commas."} hint="For example 22, 8080.">
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} value={ports} disabled={disabled} inputMode="numeric"
              onChange={(event) => {
                setPorts(event.target.value);
                const next = parsePorts(event.target.value);
                if (next) updateResource(resource.id, { openPorts: next.length ? next : undefined });
              }} />
          )}
        </Field>
      </div>
    </InspectorSection>
  );
}
