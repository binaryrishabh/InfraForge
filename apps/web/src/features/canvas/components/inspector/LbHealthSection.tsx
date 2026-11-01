import { LB_HEALTH_SECONDS_MAX, LB_HEALTH_THRESHOLD_MAX, type LbHealth, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

const controls = [
  ["intervalSeconds", "Check interval (seconds)", 5, LB_HEALTH_SECONDS_MAX],
  ["timeoutSeconds", "Check timeout (seconds)", 1, LB_HEALTH_SECONDS_MAX],
  ["unhealthyAfter", "Failures before unhealthy", 1, LB_HEALTH_THRESHOLD_MAX],
  ["healthyAfter", "Successes before healthy", 1, LB_HEALTH_THRESHOLD_MAX],
] as const;

export function LbHealthSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const commit = (field: typeof controls[number][0], value: string) => {
    const next: LbHealth = { version: 1, ...resource.lbHealth, [field]: value === "" ? undefined : Number(value) };
    updateResource(resource.id, { lbHealth: controls.every(([key]) => next[key] === undefined) ? undefined : next });
  };
  return <InspectorSection title="Health checks" hint="Consecutive failed checks stop routing to a server; consecutive successes restore it. Timeout must not exceed the interval. Blank keeps the default.">
    <div className="flex flex-col gap-4">
      {controls.map(([field, label, fallback, max]) => <Field key={field} label={label}>
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={max} step={1}
          value={resource.lbHealth?.[field] ?? ""} placeholder={`Default (${fallback})`} disabled={disabled}
          onChange={event => commit(field, event.target.value)} />}
      </Field>)}
    </div>
  </InspectorSection>;
}
