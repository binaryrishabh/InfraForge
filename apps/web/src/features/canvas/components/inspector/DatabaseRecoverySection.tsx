import type { Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function DatabaseRecoverySection({resource, disabled}: {resource: Resource; disabled: boolean}) {
  if (!resource.databaseRecoveryPlan) return null;
  return <InspectorSection title="Challenge recovery plan" hint="Saved for the next approved challenge run. The replica must be available; promotion closes existing database sessions. The modeled pools open fresh sessions automatically.">
    <Field label="Promote at simulated second" hint="Empty means no promotion. Choose a whole second in the challenge's recovery window; preflight checks the saved plan.">
      {({id, describedBy}) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={3599} step={1}
        value={resource.databaseRecoveryPlan!.promoteAtSecond ?? ""} disabled={disabled}
        onChange={event => updateResource(resource.id, {databaseRecoveryPlan: {version: 1, promoteAtSecond: event.target.value === "" ? null : Number(event.target.value)}})} />}
    </Field>
  </InspectorSection>;
}
