import { DEFAULT_RETRY_SETTINGS, type Resource, type RetrySettings, type RetryGroup } from "@infraforge/domain/resource";
import { Switch } from "@/ui/Switch";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

const groups: Array<[RetryGroup, string, string]> = [
  ["connectionFailure", "Connection failure", "A connection timed out, reset, or drained before a usable result."],
  ["timeout", "Timeout", "Waiting for a connection or a response took too long."],
  ["overload", "Overload", "A connection pool or network link was full. Retrying adds more work."],
  ["backendFailure", "Backend failure", "The application rejected the request."],
];
export function RetrySection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const policy = resource.retry;
  const commit = (patch: Partial<RetrySettings>) => updateResource(resource.id, { retry: { ...policy, enabled: policy?.enabled ?? false, ...patch } });
  return <InspectorSection title="Retries">
    <Switch label="Retry failed requests" checked={policy?.enabled === true} disabled={disabled}
      onChange={(enabled) => commit(enabled ? { ...DEFAULT_RETRY_SETTINGS, ...policy, enabled: true } : { enabled: false })}
      description="Each retry makes a new attempt through the application and database." />
    {policy?.enabled && <div className="mt-4 flex flex-col gap-4">
      {([
        ["maxAttempts", "Maximum attempts", 1, 5, 1, "Total attempts, including the first."],
        ["backoffMs", "Backoff", 1, 5000, 1, "Milliseconds before the first retry; doubles for each later retry."],
        ["jitterRatio", "Jitter", 0, 1, 0.05, "A ratio from 0 to 1; 0.2 varies the delay by up to 20%."],
        ["maxConcurrentRetries", "Concurrent retry limit", 1, 64, 1, "Counts retries waiting in backoff and retries executing."],
      ] as const).map(([key, label, min, max, step, hint]) => <Field key={key} label={label} hint={hint}>{({ id }) =>
        <Input id={id} type="number" min={min} max={max} step={step} value={policy[key] ?? ""} placeholder="Unknown" disabled={disabled}
          onChange={(e) => commit({ [key]: e.target.value === "" ? undefined : Number(e.target.value) })} />
      }</Field>)}
      <fieldset disabled={disabled}>
        <legend>Retry these failures</legend>
        {groups.map(([key,label,description]) => <label key={key} className="mt-2 block text-sm">
          <input type="checkbox" checked={policy.retryOn?.includes(key) ?? false} onChange={(e) => commit({ retryOn: e.target.checked ? [...policy.retryOn ?? [],key] : policy.retryOn?.filter((g) => g !== key) ?? [] })} /> {label}
          <span className="block text-xs text-ink-3">{description}</span>
        </label>)}
      </fieldset>
      {!policy.retryOn?.length && <p role="alert">Choose at least one failure group before running.</p>}
      <p className="text-xs text-ink-3">Reads can be retried. Writes with an unclear result are never retried, including when the application rejected the request.</p>
    </div>}
  </InspectorSection>;
}
