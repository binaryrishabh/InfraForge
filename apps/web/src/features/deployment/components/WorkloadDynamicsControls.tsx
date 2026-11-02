import type { WorkloadProfile } from "@infraforge/domain/workload";
import { Segmented } from "@/ui/Segmented";
import { withWorkloadDynamics } from "../workloadOptions";

export function WorkloadDynamicsControls({ profile, onChange, disabled }: { profile: WorkloadProfile; onChange: (p: WorkloadProfile) => void; disabled: boolean }) {
  return <>
    <div className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-[13px] font-medium text-ink-2">Arrival pattern</span>
      <Segmented label="Arrival pattern" value={profile.workloadDynamics?.arrivalProcess ?? "even"} disabled={disabled}
        onChange={arrivalProcess => onChange(withWorkloadDynamics(profile, { arrivalProcess }))} options={[{ value: "even", label: "Even" }, { value: "poisson", label: "Random (Poisson)" }]} />
      <p className="text-xs text-ink-3">Same average rate. Random traffic arrives unevenly, so short bursts can form naturally.</p>
    </div>
    <div className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-[13px] font-medium text-ink-2">Application work variability</span>
      <Segmented label="Application work variability" value={profile.workloadDynamics?.applicationCpuCv ?? 0} disabled={disabled}
        onChange={applicationCpuCv => onChange(withWorkloadDynamics(profile, { applicationCpuCv }))} options={[{ value: 0, label: "Fixed" }, { value: 0.5, label: "Moderate" }, { value: 1, label: "High" }]} />
      <p className="text-xs text-ink-3">Fixed = CV 0; Moderate = CV 0.5; High = CV 1. This educational parameter is bounded from 0 to 1; 1 gives exponential service time. Average application CPU work stays the same.</p>
    </div>
  </>;
}
