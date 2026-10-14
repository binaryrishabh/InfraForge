import type { Resource, AutoscalingPolicy } from "@infraforge/domain/resource";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { Switch } from "@/ui/Switch";
import { Field, Select } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

const A = SIMULATION_CONSTANTS.AUTOSCALING;
const COUNTS = Array.from({ length: A.DEFAULT_MAX_CAP }, (_, i) => i + 1);

/* The pool is the app servers connected to this load balancer. Copy states the
model's actual behaviour, including what the minimum does not do. */
export function AutoscalingSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const policy = resource.autoscaling ?? {};
  const enabled = policy.enabled !== false;
  const target = policy.targetCpu ?? A.DEFAULT_TARGET_CPU;
  const commit = (patch: Partial<AutoscalingPolicy>) => {
    const next = { ...policy, ...patch };
    if (next.minReplicas !== undefined && next.maxReplicas !== undefined && next.maxReplicas < next.minReplicas) next.maxReplicas = next.minReplicas;
    updateResource(resource.id, { autoscaling: next });
  };
  const toNumber = (value: string) => (value === "auto" ? undefined : Number(value));
  return (
    <InspectorSection title="Autoscaling pool">
      <Switch checked={enabled} disabled={disabled} onChange={(value) => commit({ enabled: value })} label="Add replicas under load"
        description={`After ${A.HOT_TICKS} seconds above the target CPU, one replica is added. It takes ${A.PROVISION_TICKS} seconds to come online.`} />
      {enabled && (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor={`target-${resource.id}`} className="text-[13px] font-medium text-ink-2">Target CPU</label>
              <span className="if-num text-sm text-ink">{target}%</span>
            </div>
            <input id={`target-${resource.id}`} type="range" min={50} max={90} step={5} value={target} disabled={disabled}
              onChange={(event) => commit({ targetCpu: Number(event.target.value) })} className="mt-1.5 w-full accent-[var(--if-ink)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum">{({ id }) => (
              <Select id={id} value={policy.minReplicas ?? "auto"} disabled={disabled} onChange={(event) => commit({ minReplicas: toNumber(event.target.value) })}>
                <option value="auto">As placed</option>
                {COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            )}</Field>
            <Field label="Maximum">{({ id }) => (
              <Select id={id} value={policy.maxReplicas ?? "auto"} disabled={disabled} onChange={(event) => commit({ maxReplicas: toNumber(event.target.value) })}>
                <option value="auto">{A.DEFAULT_MAX_MULTIPLIER}× placed</option>
                {COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            )}</Field>
          </div>
          <p className="text-xs leading-relaxed text-ink-3">
            The maximum is capped at {A.DEFAULT_MAX_CAP}. The minimum only limits scale-down: it does not start extra servers at launch.
          </p>
        </div>
      )}
    </InspectorSection>
  );
}
