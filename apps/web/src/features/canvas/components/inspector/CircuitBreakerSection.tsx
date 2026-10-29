import { DEFAULT_CIRCUIT_BREAKER_SETTINGS, circuitBreakerSettingsError, type Resource, type CircuitBreakerSettings } from "@infraforge/domain/resource";
import { Switch } from "@/ui/Switch";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function CircuitBreakerSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const policy = resource.circuitBreaker;
  const commit = (patch: Partial<CircuitBreakerSettings>) => updateResource(resource.id, { circuitBreaker: { ...policy, enabled: policy?.enabled ?? false, ...patch } });
  const error = circuitBreakerSettingsError(resource.type, policy);
  return <InspectorSection title="Circuit breaker">
    <Switch label="Circuit breaker" checked={policy?.enabled === true} disabled={disabled}
      onChange={(enabled) => commit(enabled ? { ...DEFAULT_CIRCUIT_BREAKER_SETTINGS, ...policy, enabled: true } : { enabled: false })}
      description="Pause calls to a repeatedly failing app server. After waiting, allow one test request before resuming." />
    {policy?.enabled && <div className="mt-4 flex flex-col gap-4">
      <Field label="Open after N failures" hint="Consecutive connection, response or backend failures on each app-server path.">{({ id, describedBy }) =>
        <Input id={id} aria-describedby={describedBy} type="number" min={1} max={100} step={1} value={policy.failureThreshold ?? ""} placeholder="Unknown" disabled={disabled}
          onChange={(e) => commit({ failureThreshold: e.target.value === "" ? undefined : Number(e.target.value) })} />
      }</Field>
      <Field label="Wait before testing again" hint="Milliseconds. One real request or health check may test recovery; other calls fail fast.">{({ id, describedBy }) =>
        <Input id={id} aria-describedby={describedBy} type="number" min={1} max={60000} step={1} value={policy.cooldownMs ?? ""} placeholder="Unknown" disabled={disabled}
          onChange={(e) => commit({ cooldownMs: e.target.value === "" ? undefined : Number(e.target.value) })} />
      }</Field>
      {error && <p role="alert">{error}</p>}
      <p className="text-xs text-ink-3">The circuit breaker does not repair the server. This load balancer does not retry a request that an open circuit rejected; a load balancer further upstream may still retry the resulting error.</p>
    </div>}
  </InspectorSection>;
}
