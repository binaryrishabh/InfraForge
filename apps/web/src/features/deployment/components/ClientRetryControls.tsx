import type { WorkloadProfile } from "@infraforge/domain/workload";
import { Segmented } from "@/ui/Segmented";
import { withClientRetry } from "../workloadOptions";

export function ClientRetryControls({ profile, onChange, disabled }: { profile: WorkloadProfile; onChange: (p: WorkloadProfile) => void; disabled: boolean }) {
  const attempts = profile.clientRetry?.maxAttempts ?? 0, backoff = profile.clientRetry?.backoffMs ?? 200;
  const backoffs = [50, 200, 1000]; if (!backoffs.includes(backoff)) backoffs.push(backoff);
  return <div className="flex flex-col gap-1.5 sm:col-span-2">
    <span className="text-[13px] font-medium text-ink-2">Client retries</span>
    <Segmented label="Client retries" value={attempts} disabled={disabled} onChange={n => onChange(withClientRetry(profile, n))}
      options={[{ value: 0, label: "Off" }, ...[2, 3, 4].map(value => ({ value, label: `${value} attempts` }))]} />
    {attempts > 0 && <>
      <span className="text-[13px] font-medium text-ink-2">First retry delay (doubles each time)</span>
      <Segmented label="Retry backoff" value={backoff} disabled={disabled} onChange={ms => onChange(withClientRetry(profile, attempts, ms))}
        options={backoffs.sort((a,b) => a-b).map(value => ({ value, label: `${value} ms` }))} />
    </>}
    <p className="text-xs text-ink-3">Clients retry rejected reads after a delay. Retries add load, so an overloaded system can get worse. Writes and rate-limited requests are not retried.</p>
  </div>;
}
