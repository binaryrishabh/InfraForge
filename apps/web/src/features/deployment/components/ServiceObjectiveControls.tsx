import type { WorkloadProfile } from "@infraforge/domain/workload";
import { Segmented } from "@/ui/Segmented";
import { withObjective } from "../workloadOptions";

export function ServiceObjectiveControls({ profile, onChange, disabled }: { profile: WorkloadProfile; onChange: (p: WorkloadProfile) => void; disabled: boolean }) {
  const objective = profile.workloadObjective;
  const response = objective?.maxResponseMs ?? 250, success = objective?.targetSuccessPercent ?? 95;
  const responses = [...new Set([50, 100, 250, 500, 1000, response])].sort((a, b) => a - b);
  const successes = [...new Set([90, 95, 99, 99.9, success])].sort((a, b) => a - b);
  return <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
    <span className="text-[13px] font-medium text-ink-2">Service objective</span>
    <Segmented label="Service objective" value={objective ? "on" : "off"} disabled={disabled}
      onChange={value => onChange(withObjective(profile, value === "off" ? null : { maxResponseMs: response, targetSuccessPercent: success }))}
      options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} />
    {objective && <div className="grid min-w-0 gap-2 sm:grid-cols-2">
      <label className="min-w-0 text-xs text-ink-2">Response target
        <select className="mt-1 w-full min-w-0 rounded-md border border-line bg-surface p-2" value={response} disabled={disabled}
          onChange={event => onChange(withObjective(profile, { maxResponseMs: Number(event.target.value), targetSuccessPercent: success }))}>
          {responses.map(value => <option key={value} value={value}>{value} ms</option>)}
        </select>
      </label>
      <label className="min-w-0 text-xs text-ink-2">Success target
        <select className="mt-1 w-full min-w-0 rounded-md border border-line bg-surface p-2" value={success} disabled={disabled}
          onChange={event => onChange(withObjective(profile, { maxResponseMs: response, targetSuccessPercent: Number(event.target.value) }))}>
          {successes.map(value => <option key={value} value={value}>{value}%</option>)}
        </select>
      </label>
    </div>}
    <p className="text-xs text-ink-3">An educational objective for this run, not a provider SLA. Requests still waiting can still change the result.</p>
  </div>;
}
